'use strict';
// Read-only account/quota RPCs through the user's OFFICIAL Codex CLI. No copied
// OAuth client IDs, no token export, no auth.json parsing, no inference or reset redemption.
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { createRequire } = require('node:module');
const { join, delimiter, dirname, isAbsolute } = require('node:path');
const { homedir } = require('node:os');

function usageError(message, status = 502) { return Object.assign(new Error(message), { status, usageError: true }); }
function findCodexExecutable() {
  if (process.env.CHILLPASS_CODEX_PATH) {
    const path = process.env.CHILLPASS_CODEX_PATH;
    if (isAbsolute(path) && existsSync(path) && (process.platform !== 'win32' || path.toLowerCase().endsWith('.exe'))) return path;
    throw usageError('CHILLPASS_CODEX_PATH 必须是官方 Codex 可执行文件的绝对路径。');
  }
  const dirs = (process.env.PATH || '').split(delimiter).map(p => p.replace(/^"|"$/g, '')).filter(p => isAbsolute(p));
  for (const dir of dirs) {
    const path = join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (existsSync(path)) return path;
  }
  // Windows npm's codex.cmd wraps Node; resolve its native optional package
  // instead of spawning cmd.exe or relying on process.execPath (which can be SEA).
  if (process.platform === 'win32') {
    const target = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    for (const dir of dirs) {
      const root = join(dir, 'node_modules', '@openai', 'codex');
      const manifest = join(root, 'package.json');
      if (!existsSync(manifest)) continue;
      let vendor = join(root, 'vendor');
      try { vendor = join(dirname(createRequire(manifest).resolve(`@openai/codex-win32-${process.arch}/package.json`)), 'vendor'); } catch { /* older bundled distribution */ }
      const path = join(vendor, target, 'bin', 'codex.exe');
      if (existsSync(path)) return path;
    }
  }
  throw usageError('未找到官方 Codex CLI。请安装 @openai/codex，运行 codex login 登录同一 ChatGPT 账号，然后重试。', 409);
}

function openClient(executable, signal, spawnImpl = spawn) {
  if (signal?.aborted) throw usageError('额度查询已取消。', 499);
  const child = spawnImpl(executable, ['app-server', '--listen', 'stdio://', '-c', 'model_provider="openai"', '-c', 'analytics.enabled=false'], {
    cwd: homedir(), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map(); let id = 0, buffer = '', closed = false;
  const stop = error => {
    if (closed) return;
    closed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear(); child.stdin.end(); child.kill();
  };
  const abort = () => stop(usageError('额度查询已取消。', 499));
  const timer = setTimeout(() => stop(usageError('Codex 额度查询超时，请检查网络、代理或 Codex 登录状态。', 504)), 35000);
  signal?.addEventListener('abort', abort, { once: true });
  child.on('error', () => stop(usageError('无法启动官方 Codex CLI，请确认安装完整。')));
  child.on('exit', () => stop(usageError('Codex 额度进程已退出，请更新官方 CLI 后重试。')));
  child.stdin.on('error', () => stop(usageError('Codex 额度进程连接已断开。')));
  child.stderr.resume(); // Logs can contain identity material; never expose them.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) { stop(usageError('Codex 返回的数据过大。')); return; }
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { stop(usageError('Codex 返回了无效的 RPC 数据。')); return; }
      const entry = pending.get(message.id);
      if (!entry) continue;
      pending.delete(message.id);
      if (message.error) entry.reject(usageError(`Codex ${entry.method === 'account/rateLimits/read' ? '额度查询' : '账号读取'}失败。请运行 codex login 检查登录，并确认网络可访问 ChatGPT。`));
      else entry.resolve(message.result);
    }
  });
  const send = object => child.stdin.write(`${JSON.stringify(object)}\n`);
  return {
    request(method, params) {
      if (closed) return Promise.reject(usageError('Codex 额度进程已关闭。'));
      const requestId = ++id;
      return new Promise((resolve, reject) => { pending.set(requestId, { resolve, reject, method }); send({ id: requestId, method, params }); });
    },
    notify: method => send({ method }),
    close: () => stop(usageError('Codex 额度连接已关闭。')),
  };
}

function checkAccount(result, expectedEmail) {
  const account = result?.account;
  if (account?.type !== 'chatgpt') throw usageError('本机 Codex 尚未以 ChatGPT 登录。请运行 codex login 登录同一账号后重试（API Key 登录不能查询订阅额度）。', 409);
  if (typeof expectedEmail !== 'string' || !expectedEmail.trim() || typeof account.email !== 'string'
    || account.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) {
    throw usageError('本机 Codex 与 ChillPass 的 ChatGPT 账号不一致，已停止查询，避免显示其他账号的额度。请先在 Codex 登录同一账号。', 409);
  }
}
function translateSnapshot(data) {
  const main = data?.rateLimitsByLimitId?.codex || data?.rateLimits;
  const window = value => value && ({ used_percent: value.usedPercent, limit_window_seconds: typeof value.windowDurationMins === 'number' ? value.windowDurationMins * 60 : undefined, reset_at: value.resetsAt });
  const group = value => ({ primary_window: window(value?.primary), secondary_window: window(value?.secondary) });
  const additional = Object.entries(data?.rateLimitsByLimitId || {}).filter(([key, value]) => key !== 'codex' && value !== main)
    .slice(0, 20).map(([key, value]) => ({ limit_name: value.limitName || key, rate_limit: group(value) }));
  const summary = data?.rateLimitResetCredits;
  // Detail rows allow expired/redeemed credits to be excluded, as in CC Switch.
  // An absent summary is unknown, NOT zero. Older CLI releases omit it entirely.
  let resetCredits = null;
  if (Array.isArray(summary?.credits)) {
    resetCredits = summary.credits.filter(item => item.status === 'available' && (item.expiresAt == null || (Number.isFinite(item.expiresAt) && item.expiresAt * 1000 > Date.now()))).length;
  } else if (Number.isInteger(summary?.availableCount) && summary.availableCount >= 0) resetCredits = summary.availableCount;
  return {
    payload: { rate_limit: group(main), additional_rate_limits: additional, credits: main?.credits && { balance: main.credits.balance, unlimited: main.credits.unlimited } },
    resetCredits,
    workspaceId: typeof data?.accountId === 'string' ? data.accountId : null,
  };
}
async function queryCodexUsage({ expectedEmail, expectedWorkspaceId, signal, executable, spawnImpl } = {}) {
  const client = openClient(executable || findCodexExecutable(), signal, spawnImpl);
  try {
    await client.request('initialize', { clientInfo: { name: 'chillpass_usage', title: 'ChillPass quota reader', version: '0.2.3' }, capabilities: {} });
    client.notify('initialized');
    checkAccount(await client.request('account/read', { refreshToken: false }), expectedEmail);
    const data = await client.request('account/rateLimits/read', {});
    checkAccount(await client.request('account/read', { refreshToken: false }), expectedEmail);
    const result = translateSnapshot(data);
    if (expectedWorkspaceId && result.workspaceId !== expectedWorkspaceId) throw usageError('Codex 工作区已变化，请在设置中断开额度读取后重新连接确认。', 409);
    return result;
  } finally { client.close(); }
}
module.exports = { queryCodexUsage, translateSnapshot, findCodexExecutable };
