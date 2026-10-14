'use strict';
// Official public-client OAuth + PKCE. Never reuse another application's client ID.
const { createServer } = require('node:http');
const { randomBytes, randomUUID, createHash, createPublicKey, verify, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { queryCodexUsage } = require('./codex-usage.cjs');

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const TERMINAL_REFRESH = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);

class AuthError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function trustedOpenAIUrl(value) {
  const url = new URL(value);
  if (url.origin !== ISSUER || url.username || url.password) throw new AuthError('OpenAI 身份发现文档无效。', 502);
  return url.href;
}

// Windows DPAPI CurrentUser; secrets travel over stdin, never process arguments.
async function protectWindows(value, decrypt = false) {
  const method = decrypt ? 'Unprotect' : 'Protect';
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${method}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.resume(); // Never log a crypto exception containing user material.
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new AuthError('无法使用 Windows DPAPI 保护登录凭据。', 500)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new AuthError('无法读取或保存 Windows 加密凭据，请使用原 Windows 用户。', 500));
      else resolve(Buffer.from(Buffer.concat(chunks).toString().trim(), 'base64'));
    });
    child.stdin.end(value.toString('base64'));
  });
}

async function validateIdToken(token, { clientId, nonce, subject, fetchImpl, discovery }) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error();
    const response = await fetchImpl(trustedOpenAIUrl(discovery.jwks_uri), { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error();
    const { keys } = await response.json();
    const jwk = keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256'));
    if (!jwk || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error();
    const now = Date.now() / 1000;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== ISSUER || !aud.includes(clientId) || (aud.length > 1 && claims.azp !== clientId)
      || (claims.azp && claims.azp !== clientId) || typeof claims.exp !== 'number' || claims.exp <= now
      || (typeof claims.nbf === 'number' && claims.nbf > now + 30)
      || !same(claims.nonce, nonce) || typeof claims.sub !== 'string' || !claims.sub
      || (subject && claims.sub !== subject)) throw new Error();
    return claims;
  } catch {
    throw new AuthError('ChatGPT 身份校验失败，请重新登录（签名、账号或授权信息不匹配）。', 401);
  }
}

// Normalize subscription windows; credentials/routing are owned by the official Codex CLI.
function normalizeChatGPTUsage(payload) {
  const windows = [];
  const add = (group, prefix = '') => {
    for (const [key, fallback] of [['primary_window', '主额度'], ['secondary_window', '次额度']]) {
      const item = group?.[key];
      if (!item || typeof item.used_percent !== 'number' || !Number.isFinite(item.used_percent)) continue;
      const seconds = item.limit_window_seconds;
      const period = seconds === 604800 ? '每周' : seconds === 86400 ? '每日'
        : typeof seconds === 'number' && seconds > 0 && Number.isFinite(seconds) ? `${Math.round(seconds / 360) / 10}h` : fallback;
      const used = Math.min(100, Math.max(0, item.used_percent));
      windows.push({ label: `${prefix}${period}`, usedPercent: used, remainingPercent: 100 - used,
        ...(typeof item.reset_at === 'number' && Number.isFinite(item.reset_at) && item.reset_at > 0 ? { resetsAt: item.reset_at * 1000 } : {}) });
    }
  };
  add(payload?.rate_limit);
  if (Array.isArray(payload?.additional_rate_limits)) {
    for (const item of payload.additional_rate_limits.slice(0, 20)) {
      const name = typeof item?.limit_name === 'string' ? item.limit_name.slice(0, 80) : '附加额度';
      add(item?.rate_limit, `${name} · `);
    }
  }
  const credit = payload?.credits;
  const balance = typeof credit?.balance === 'number' ? credit.balance
    : typeof credit?.balance === 'string' && credit.balance.trim() ? Number(credit.balance) : NaN;
  const credits = credit?.unlimited === true ? 'unlimited' : Number.isFinite(balance) && balance >= 0 ? balance : null;
  if (!windows.length && credits === null) throw new AuthError('ChatGPT 未返回可识别的余量数据，不能据此判断额度为零。', 502);
  return { windows, credits, capturedAt: Date.now() };
}

function createChatGPTAuth({ configDir, fetchImpl = fetch, usageQuery = queryCodexUsage, protect = process.platform === 'win32' ? protectWindows : async value => value }) {
  const dir = join(configDir, 'chatgpt');
  const file = join(dir, 'credentials.dat');
  const lockPath = join(dir, 'credentials.lock');
  let queue = Promise.resolve();
  let pending = null;
  let lastError = '';
  let metadata;
  const requests = new Set();
  const usageRequests = new Set();
  const catalogs = new Map();

  async function discovery() {
    if (metadata) return metadata;
    const response = await fetchImpl(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new AuthError('无法读取 OpenAI 登录配置，请检查网络。', 502);
    const value = await response.json();
    if (value.issuer !== ISSUER) throw new AuthError('OpenAI issuer 不匹配。', 502);
    trustedOpenAIUrl(value.jwks_uri);
    metadata = value;
    return value;
  }
  async function readStore() {
    try {
      const data = JSON.parse((await protect(await fs.readFile(file), true)).toString('utf8'));
      if (data.version !== 1 || !Array.isArray(data.accounts) || typeof data.hostId !== 'string') throw new Error('Invalid store');
      return data;
    } catch (e) {
      if (e.code === 'ENOENT') return { version: 1, hostId: `urn:uuid:${randomUUID()}`, activeId: null, accounts: [] };
      throw new AuthError('无法读取 ChatGPT 凭据文件；未覆盖原文件。', 500);
    }
  }
  async function saveStore(store) {
    const temp = join(dir, `credentials-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, await protect(Buffer.from(JSON.stringify(store))), { flag: 'wx', mode: 0o600 });
      await fs.rename(temp, file);
    } finally { await fs.rm(temp, { force: true }); }
  }
  // Also lock on disk: dev and production instances must not race rotating refresh tokens.
  function transaction(fn) {
    const task = queue.then(async () => {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      let lock;
      try { lock = await fs.open(lockPath, 'wx', 0o600); }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        throw new AuthError('另一个 ChillPass 实例正在使用 ChatGPT 凭据。请稍后重试；若曾异常退出，请关闭所有实例后删除 chatgpt/credentials.lock。', 409);
      }
      try { return await fn(await readStore()); }
      finally { await lock.close(); await fs.rm(lockPath, { force: true }); }
    });
    queue = task.catch(() => {});
    return task;
  }
  const active = store => store.accounts.find(a => a.clientId === store.activeId);
  function publicState(store) {
    const account = active(store);
    return {
      activeId: store.activeId,
      usageConnected: Boolean(account?.accessToken && account.usageSource === 'codex-cli'),
      connected: Boolean(account?.accessToken),
      planEnabled: Boolean(account?.accessToken && account.scopes?.includes(PLAN_SCOPE)),
      pending: Boolean(pending), error: lastError,
      accounts: store.accounts.map(a => ({ id: a.clientId, email: a.email, label: a.label, connected: Boolean(a.accessToken), planEnabled: Boolean(a.accessToken && a.scopes?.includes(PLAN_SCOPE)) })),
    };
  }
  function stopRequests() { for (const controller of requests) controller.abort(); catalogs.clear(); }
  function stopPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.server.close();
    pending.server.closeAllConnections();
    pending = null;
  }
  function tokenFields(result, previous = {}) {
    if (typeof result.access_token !== 'string' || !result.access_token || result.token_type?.toLowerCase() !== 'bearer'
      || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new AuthError('OpenAI 返回的令牌信息不完整。', 502);
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token || previous.refreshToken,
      idToken: result.id_token || previous.idToken,
      expiresAt: Date.now() + result.expires_in * 1000,
      scopes: typeof result.scope === 'string' ? result.scope.split(/\s+/) : (previous.scopes || []),
    };
  }
  async function tokenRequest(params) {
    const response = await fetchImpl(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(25000), redirect: 'error' });
    let data;
    try { data = await response.json(); } catch { throw new AuthError('OpenAI 令牌服务返回了无效响应。', 502); }
    if (!response.ok) {
      const code = typeof data.error === 'string' ? data.error : data.error?.code;
      const error = new AuthError(`ChatGPT 授权失败 (${response.status} / ${/^[a-z_]+$/.test(code || '') ? code : 'oauth_error'})，请稍后重试或重新登录。`, response.status);
      error.oauthCode = code;
      throw error;
    }
    return data;
  }
  async function accessAccount() {
    return transaction(async store => {
      const account = active(store);
      if (!account?.accessToken) throw new AuthError('请先在设置中登录 ChatGPT。', 401);
      if (account.expiresAt < Date.now() + 60000) {
        if (!account.refreshToken) throw new AuthError('ChatGPT 登录已过期，请重新登录。', 401);
        try {
          const result = await tokenRequest({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.refreshToken, resource: RESOURCE });
          if (!result.refresh_token) throw new AuthError('刷新响应缺少轮换令牌，请重新登录。', 502);
          Object.assign(account, tokenFields(result, account));
          await saveStore(store);
        } catch (e) {
          if (TERMINAL_REFRESH.has(e.oauthCode)) {
            clearTokens(account);
            await saveStore(store);
          }
          throw e;
        }
      }
      if (!account.scopes?.includes(PLAN_SCOPE)) throw new AuthError('尚未授权使用 ChatGPT 套餐，请在设置中启用套餐授权或选择 API Key 服务商。', 403);
      return { ...account };
    });
  }
  function clearTokens(account) {
    for (const key of ['accessToken', 'refreshToken', 'idToken', 'expiresAt', 'scopes', 'usageSource', 'usageWorkspaceId']) delete account[key];
  }
  async function start(accountId, consent = false) {
    return transaction(async store => {
      const account = accountId ? store.accounts.find(a => a.clientId === accountId) : null;
      if (accountId && !account) throw new AuthError('未找到该 ChatGPT 账号。');
      stopPending(); lastError = '';
      const attempt = {
        state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'),
        verifier: randomBytes(48).toString('base64url'), clientId: account?.clientId,
        subject: account?.subject, busy: false,
      };
      attempt.server = createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        const url = new URL(req.url, attempt.redirectUri);
        const expectedHost = new URL(attempt.redirectUri).host;
        if (req.method !== 'GET' || req.headers.host !== expectedHost || url.pathname !== '/auth/callback') { res.writeHead(404); res.end(); return; }
        if (pending !== attempt || !same(url.searchParams.get('state'), attempt.state) || attempt.busy) { res.writeHead(400); res.end('Invalid or expired OAuth state.'); return; }
        attempt.busy = true;
        try {
          await transaction(async latest => {
            if (pending !== attempt) throw new AuthError('登录已取消，请重新开始。');
            if (url.searchParams.has('error')) throw new AuthError('ChatGPT 授权已取消或被拒绝。');
            const returned = url.searchParams.get('client_id');
            const clientId = attempt.clientId || returned;
            if (!clientId || clientId === 'dynamic_agent_client' || (attempt.clientId && returned && returned !== attempt.clientId)) throw new AuthError('ChatGPT 注册返回的 client_id 不匹配。');
            const code = url.searchParams.get('code');
            if (!code) throw new AuthError('ChatGPT 登录回调缺少授权码。');
            const result = await tokenRequest({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE });
            const identity = await validateIdToken(result.id_token, { clientId, nonce: attempt.nonce, subject: attempt.subject, fetchImpl, discovery: await discovery() });
            if (pending !== attempt) throw new AuthError('登录已取消或超时，请重新开始。');
            let saved = latest.accounts.find(a => a.clientId === clientId);
            if (saved && saved.subject !== identity.sub) throw new AuthError('该注册绑定的 ChatGPT 账号不匹配。', 401);
            if (!saved) { saved = { clientId, subject: identity.sub, label: `账号 ${latest.accounts.length + 1}` }; latest.accounts.push(saved); }
            Object.assign(saved, tokenFields(result), { email: typeof identity.email === 'string' ? identity.email : '', issuer: identity.iss });
            latest.activeId = clientId;
            stopRequests();
            await saveStore(latest);
          });
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('ChatGPT 登录成功。请关闭此标签页，返回 ChillPass 选择模型。');
        } catch (e) {
          lastError = e instanceof AuthError ? e.message : 'ChatGPT 登录未完成，请检查网络后重新登录。';
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`${lastError}\n请关闭此标签页，返回 ChillPass。`);
        } finally {
          if (pending === attempt) { clearTimeout(attempt.timer); pending = null; }
          attempt.server.close();
        }
      });
      await new Promise((resolve, reject) => { attempt.server.once('error', reject); attempt.server.listen(0, '127.0.0.1', resolve); });
      attempt.redirectUri = `http://127.0.0.1:${attempt.server.address().port}/auth/callback`;
      pending = attempt;
      attempt.timer = setTimeout(() => { if (pending === attempt) { lastError = '登录等待超时，请重新开始。'; stopPending(); } }, 10 * 60 * 1000);
      attempt.timer.unref();
      try { await saveStore(store); } catch (e) { stopPending(); throw e; }
      const url = new URL(AUTHORIZE);
      url.search = new URLSearchParams({
        client_id: account?.clientId || 'dynamic_agent_client', ext_agent_host_id: store.hostId,
        response_type: 'code', redirect_uri: attempt.redirectUri, scope: SCOPES, resource: RESOURCE,
        state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
        ...(!account ? { agent_name_hint: 'ChillPass' } : {}),
        ...(account?.idToken ? { id_token_hint: account.idToken } : {}),
        ...(account?.email ? { login_hint: account.email } : {}),
        ...(consent ? { prompt: 'consent' } : {}),
      }).toString();
      return { authorizationUrl: url.href };
    });
  }
  async function models(account, signal, refresh = false) {
    const cached = catalogs.get(account.clientId);
    if (!refresh && cached && Date.now() - cached.time < 60000) return cached.models;
    const response = await fetchImpl(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${account.accessToken}` }, signal, redirect: 'error' });
    if (!response.ok) return response;
    const data = await response.json();
    if (!Array.isArray(data.models)) throw new AuthError('ChatGPT 模型目录格式无效。', 502);
    const list = data.models.filter(m => m.visibility === 'list' && typeof m.slug === 'string')
      .map(m => ({ id: m.slug, name: typeof m.display_name === 'string' ? m.display_name : m.slug }));
    catalogs.set(account.clientId, { models: list, time: Date.now() });
    return list;
  }
  async function proxyFailure(response, res) {
    const requestId = response.headers.get('x-request-id');
    if (requestId) res.setHeader('x-request-id', requestId);
    const retry = response.headers.get('retry-after');
    if (retry) res.setHeader('retry-after', retry);
    res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
    res.end(await response.text());
  }
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 24 * 1024 * 1024) throw new AuthError('请求内容超过 24 MB，请减少附件。', 413);
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
    catch { throw new AuthError('无效 JSON 请求。'); }
  }
  function checkLocal(req) {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) throw new AuthError('ChatGPT 登录仅允许在本机使用。', 403);
    if (!/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(req.headers.host || '')) throw new AuthError('Invalid local host.', 403);
    if (req.headers['x-chillpass-client'] !== '1') throw new AuthError('Missing local client header.', 403);
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new AuthError('Cross-origin request denied.', 403);
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new AuthError('Cross-site request denied.', 403);
  }
  async function handle(req, res, path) {
    if (!path.startsWith('/api/chatgpt/')) return false;
    res.setHeader('Cache-Control', 'no-store');
    try {
      checkLocal(req);
      if (path === '/api/chatgpt/status' && req.method === 'GET') {
        json(res, await transaction(store => publicState(store)));
      } else if (path === '/api/chatgpt/login' && req.method === 'POST') {
        const input = await body(req); json(res, await start(input.accountId, input.consent === true));
      } else if (path === '/api/chatgpt/cancel' && req.method === 'POST') {
        stopPending(); lastError = ''; json(res, { ok: true });
      } else if (path === '/api/chatgpt/switch' && req.method === 'POST') {
        const input = await body(req);
        json(res, await transaction(async store => {
          const account = store.accounts.find(a => a.clientId === input.accountId);
          if (!account?.accessToken) throw new AuthError('请先重新登录该 ChatGPT 账号。', 401);
          stopPending(); stopRequests(); store.activeId = account.clientId; lastError = '';
          await saveStore(store); return publicState(store);
        }));
      } else if (path === '/api/chatgpt/logout' && req.method === 'POST') {
        stopPending(); stopRequests();
        json(res, await transaction(async store => {
          const account = active(store); let revoked = true;
          if (account?.refreshToken) {
            revoked = false;
            try {
              const endpoint = trustedOpenAIUrl((await discovery()).revocation_endpoint);
              for (let i = 0; i < 2; i++) {
                try {
                  const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: account.refreshToken, token_type_hint: 'refresh_token', client_id: account.clientId }), signal: AbortSignal.timeout(10000), redirect: 'error' });
                  if (response.ok) { revoked = true; break; }
                  if (response.status < 500) break;
                } catch { /* bounded retry before clearing local tokens */ }
                if (i === 0) await new Promise(resolve => setTimeout(resolve, 500));
              }
            } catch { /* Clear local credentials even when offline. */ }
          }
          if (account) clearTokens(account);
          lastError = ''; await saveStore(store);
          return { ...publicState(store), warning: revoked ? '' : '已退出本机登录，但未能确认远程撤销。请在 ChatGPT 设置中断开 ChillPass。' };
        }));
      } else if (path === '/api/chatgpt/usage/disconnect' && req.method === 'POST') {
        const input = await body(req);
        json(res, await transaction(async store => {
          const account = active(store);
          if (!account || account.clientId !== input.accountId) throw new AuthError('账号已变化，请重试。', 409);
          for (const controller of usageRequests) controller.abort();
          delete account.usageSource; delete account.usageWorkspaceId;
          await saveStore(store); return publicState(store);
        }));
      } else if ((path === '/api/chatgpt/usage' && req.method === 'GET') || (path === '/api/chatgpt/usage/connect' && req.method === 'POST')) {
        const connecting = req.method === 'POST';
        const input = connecting ? await body(req) : null;
        const controller = new AbortController(); requests.add(controller); usageRequests.add(controller);
        const disconnect = () => controller.abort(); res.on('close', disconnect);
        try {
          const account = await transaction(store => {
            const account = active(store);
            if (!account?.accessToken) throw new AuthError('请先在设置中登录 ChatGPT。', 401);
            if (connecting && input.accountId !== account.clientId) throw new AuthError('账号已变化，请重试。', 409);
            if (!connecting && account.usageSource !== 'codex-cli') throw new AuthError('请先连接本机 Codex 额度。套餐 OAuth 不能调用 Codex 的余量接口。', 409);
            return { clientId: account.clientId, email: account.email, workspaceId: account.usageWorkspaceId };
          });
          const result = await usageQuery({ expectedEmail: account.email, expectedWorkspaceId: connecting ? undefined : account.workspaceId, signal: controller.signal });
          const report = { ...normalizeChatGPTUsage(result.payload), resetCredits: result.resetCredits, source: 'codex-cli', accountId: account.clientId };
          await transaction(async store => {
            const current = active(store);
            if (controller.signal.aborted || current?.clientId !== account.clientId || !current?.accessToken || current.email !== account.email) throw new AuthError('账号已变化或查询已取消，请重试。', 409);
            if (connecting) {
              current.usageSource = 'codex-cli'; current.usageWorkspaceId = result.workspaceId;
              await saveStore(store);
            } else if (current.usageSource !== 'codex-cli') throw new AuthError('额度连接已断开。', 409);
          });
          json(res, report);
        } finally { controller.abort(); requests.delete(controller); usageRequests.delete(controller); res.off('close', disconnect); }
      } else if ((path === '/api/chatgpt/models' && req.method === 'GET') || (path === '/api/chatgpt/responses' && req.method === 'POST')) {
        const controller = new AbortController(); requests.add(controller);
        const disconnect = () => controller.abort();
        res.on('close', disconnect);
        let timer;
        const touch = () => { clearTimeout(timer); timer = setTimeout(disconnect, 90000); };
        touch();
        try {
          const input = req.method === 'POST' ? await body(req) : null;
          const account = await accessAccount();
          if (controller.signal.aborted) throw new AuthError('请求已取消。', 499);
          const list = await models(account, controller.signal, !input);
          if (!Array.isArray(list)) { await proxyFailure(list, res); return true; }
          if (!input) { json(res, { models: list, accountId: account.clientId }); return true; }
          const model = input.model || list[0]?.id;
          if (!model || !list.some(m => m.id === model)) throw new AuthError('当前 ChatGPT 账号不支持所选模型，请在设置中刷新并选择模型。');
          if (!Array.isArray(input.input) || !input.input.length) throw new AuthError('缺少模型输入。');
          // Allowlist request fields; callers cannot override the endpoint, billing or credentials.
          const payload = { model, input: input.input, store: false, stream: true };
          if (Number.isInteger(input.max_output_tokens) && input.max_output_tokens > 0) payload.max_output_tokens = input.max_output_tokens;
          if (['low', 'medium', 'high'].includes(input.reasoning?.effort)) payload.reasoning = { effort: input.reasoning.effort };
          if (input.text?.format?.type === 'json_object') payload.text = { format: { type: 'json_object' } };
          const response = await fetchImpl(`${RESOURCE}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal, redirect: 'error' });
          if (!response.ok) { await proxyFailure(response, res); return true; }
          if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new AuthError('ChatGPT 未返回预期的事件流。', 502);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...(response.headers.get('x-request-id') ? { 'x-request-id': response.headers.get('x-request-id') } : {}) });
          for await (const chunk of response.body) {
            touch();
            if (!res.write(chunk)) await once(res, 'drain', { signal: controller.signal });
          }
          res.end();
        } finally { clearTimeout(timer); controller.abort(); requests.delete(controller); res.off('close', disconnect); }
      } else json(res, { error: 'Not found' }, 404);
    } catch (e) {
      if (res.headersSent) res.destroy();
      else if (!res.destroyed) json(res, { error: e instanceof AuthError || e.usageError === true ? e.message : 'ChatGPT 连接失败，请检查网络后重试。' }, e.status || 502);
    }
    return true;
  }
  handle.close = () => { stopPending(); stopRequests(); };
  return handle;
}

module.exports = { createChatGPTAuth, validateIdToken, protectWindows, normalizeChatGPTUsage };
