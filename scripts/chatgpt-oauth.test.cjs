'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const os = require('node:os');
const { createServer, request: httpRequest } = require('node:http');
const { generateKeyPairSync, sign, createHash } = require('node:crypto');
const vm = require('node:vm');
const ts = require('typescript');
const { createChatGPTAuth, protectWindows, normalizeChatGPTUsage } = require('../installer/chatgpt-auth.cjs');
const issuer = 'https://auth.openai.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
function jwt(claims) {
  const payload = [ { alg: 'RS256', kid: 'test-key' }, claims ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${payload}.${sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64url')}`;
}
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const events = list => list.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
const completion = [
  { type: 'response.output_text.delta', delta: '你好' },
  { type: 'response.completed', response: { usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } } },
];
async function fixture(t) {
  const root = process.env.CHILLPASS_TEST_TMP || join(os.tmpdir(), 'chillpass-tests');
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(join(root, 'oauth-'));
  const tokens = new Map();
  const calls = [];
  let refreshes = 0, refreshError = '', granted = scopes, inference = completion, revokeFails = false, usageStatus = 200;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/.well-known/openid-configuration')) return reply({ issuer, jwks_uri: `${issuer}/jwks`, revocation_endpoint: `${issuer}/revoke` });
    if (url.endsWith('/jwks')) return reply({ keys: [jwk] });
    if (url.endsWith('/oauth/token')) {
      const params = new URLSearchParams(init.body);
      assert.equal(params.get('resource'), 'https://api.openai.com/v1');
      if (params.get('grant_type') === 'refresh_token') {
        refreshes++;
        if (refreshError) return reply({ error: refreshError }, 400);
        return reply({ access_token: `refreshed-${refreshes}`, refresh_token: `rotated-${refreshes}`, token_type: 'Bearer', expires_in: 3600, scope: granted });
      }
      const saved = tokens.get(params.get('code'));
      assert.ok(saved, 'unknown authorization code');
      assert.equal(params.get('client_id'), saved.clientId);
      assert.equal(params.get('redirect_uri'), saved.redirectUri);
      assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), saved.challenge);
      return reply({ access_token: `access-${saved.clientId}`, refresh_token: `refresh-${saved.clientId}`, id_token: saved.idToken, token_type: 'Bearer', expires_in: 3600, scope: granted });
    }
    if (url.endsWith('/revoke')) {
      assert.equal(new URLSearchParams(init.body).get('token_type_hint'), 'refresh_token');
      return revokeFails ? reply({}, 503) : new Response('', { status: 200 });
    }
    if (url.endsWith('/models')) return reply({ models: [{ slug: 'test-model', display_name: 'Test Model', visibility: 'list' }, { slug: 'hidden', visibility: 'hidden' }] });
    if (url.endsWith('/responses')) return new Response(events(inference), { headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req-test' } });
    throw new Error(`Unexpected URL: ${url}`);
  };
  let usageCalls = 0;
  const usageQuery = async options => {
    usageCalls++;
    assert.equal(options.expectedEmail, 'user-a@example.test');
    assert.equal(options.accessToken, undefined);
    if (usageStatus !== 200) throw Object.assign(new Error('Codex fixture denied'), { status: usageStatus, usageError: true });
    return { payload: { rate_limit: { primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_at: 1900000000 } }, credits: { balance: '0' }, private_metadata: 'not-for-browser' }, workspaceId: 'workspace-a', resetCredits: 2 };
  };
  const handler = createChatGPTAuth({ configDir: dir, fetchImpl, usageQuery, protect: async value => value });
  const server = createServer((req, res) => { void handler(req, res, new URL(req.url, 'http://localhost').pathname); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  const request = (path, body, headers = {}) => {
    // Fetch implementations can override a caller-supplied Host header; use native HTTP for this attack fixture.
    if (headers.Host) return new Promise((resolve, reject) => {
      const req = httpRequest(`${base}/api/chatgpt${path}`, { headers: { 'X-ChillPass-Client': '1', ...headers } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode })));
      });
      req.on('error', reject); req.end();
    });
    return fetch(`${base}/api/chatgpt${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-ChillPass-Client': '1', 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  async function start(accountId, consent) {
    const response = await request('/login', { accountId, consent }); assert.equal(response.status, 200);
    return new URL((await response.json()).authorizationUrl);
  }
  let codeNumber = 0;
  async function complete(url, { clientId = url.searchParams.get('client_id') === 'dynamic_agent_client' ? `oaiapp_${++codeNumber}` : url.searchParams.get('client_id'), subject = 'user-a', claims = {}, signatureInvalid = false } = {}) {
    const code = `code-${++codeNumber}`;
    const p = url.searchParams;
    const token = jwt({ iss: issuer, aud: clientId, sub: subject, nonce: p.get('nonce'), exp: Math.floor(Date.now() / 1000) + 3600, email: `${subject}@example.test`, ...claims });
    tokens.set(code, { clientId, redirectUri: p.get('redirect_uri'), challenge: p.get('code_challenge'), idToken: signatureInvalid ? token.slice(0, -6) + 'broken' : token });
    const callback = new URL(p.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: p.get('state'), code, client_id: clientId });
    return fetch(callback);
  }
  const file = join(dir, 'chatgpt', 'credentials.dat');
  async function expire() {
    const store = JSON.parse(await fs.readFile(file, 'utf8'));
    store.accounts.find(a => a.clientId === store.activeId).expiresAt = 0;
    await fs.writeFile(file, JSON.stringify(store));
  }
  return { request, start, complete, calls, expire, file,
    refreshCount: () => refreshes,
    setRefreshError: value => { refreshError = value; },
    setScopes: value => { granted = value; },
    failRevoke: () => { revokeFails = true; },
    setUsageStatus: value => { usageStatus = value; },
    usageCalls: () => usageCalls,
  };
}

test('OAuth registration, scoped models, Responses allowlist and credential privacy', async t => {
  const f = await fixture(t);
  const url = await f.start();
  assert.equal(url.origin, issuer);
  assert.equal(url.pathname, '/api/accounts/authorize');
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('agent_name_hint'), 'ChillPass');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(new URL(url.searchParams.get('redirect_uri')).hostname, '127.0.0.1');
  assert.equal((await f.complete(url)).status, 200);
  const statusText = await (await f.request('/status')).text();
  assert.equal(JSON.parse(statusText).planEnabled, true);
  assert.doesNotMatch(statusText, /accessToken|refreshToken|idToken|access_token|refresh_token/);
  const models = await (await f.request('/models')).json();
  assert.deepEqual(models.models, [{ id: 'test-model', name: 'Test Model' }]);
  const response = await f.request('/responses', { model: 'test-model', input: [{ role: 'user', content: 'Hi' }], store: true, stream: false, temperature: 0.8, tools: ['untrusted'], endpoint: 'https://evil.test', text: { format: { type: 'json_object' } }, max_output_tokens: 4000 });
  assert.equal(response.status, 200); assert.match(await response.text(), /response.completed/);
  const body = JSON.parse(f.calls.find(call => call.url.endsWith('/responses')).init.body);
  assert.equal(body.store, false); assert.equal(body.stream, true);
  assert.equal(body.temperature, undefined); assert.equal(body.tools, undefined); assert.equal(body.endpoint, undefined);
  assert.equal(body.max_output_tokens, 4000);
  assert.equal((await f.request('/responses', { model: 'hidden', input: [{}] })).status, 400);
});

test('loopback API rejects cross-origin, missing client header and DNS rebinding', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/login', {}, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.request('/status', undefined, { 'X-ChillPass-Client': '' })).status, 403);
  assert.equal((await f.request('/status', undefined, { Host: 'evil.test:1234' })).status, 403);
  assert.equal(f.calls.length, 0);
});

test('invalid state and declined consent never exchange a code', async t => {
  const f = await fixture(t); const url = await f.start();
  const callback = new URL(url.searchParams.get('redirect_uri'));
  callback.search = new URLSearchParams({ state: 'bad', code: 'bad', client_id: 'bad' });
  assert.equal((await fetch(callback)).status, 400);
  callback.search = new URLSearchParams({ state: url.searchParams.get('state'), error: 'access_denied' });
  assert.equal((await fetch(callback)).status, 400);
  const status = await (await f.request('/status')).json();
  assert.equal(status.pending, false); assert.equal(status.connected, false);
  assert.equal(f.calls.length, 0);
});

test('ID token requires signature, issuer, audience, nonce and expiry', async t => {
  const f = await fixture(t);
  for (const options of [{ claims: { iss: 'https://evil.test' } }, { claims: { aud: 'other-app' } }, { claims: { nonce: 'bad' } }, { claims: { exp: 1 } }, { signatureInvalid: true }]) {
    assert.equal((await f.complete(await f.start(), options)).status, 400);
    assert.equal((await (await f.request('/status')).json()).connected, false);
  }
});

test('accounts stay separate; reauthorization validates original identity and client', async t => {
  const f = await fixture(t);
  const initial = await f.start(); await f.complete(initial, { clientId: 'account-a' });
  await f.complete(await f.start(), { clientId: 'account-b', subject: 'user-b' });
  let state = await (await f.request('/status')).json();
  assert.equal(state.accounts.length, 2); assert.equal(state.activeId, 'account-b');
  await f.request('/switch', { accountId: 'account-a' });
  const returning = await f.start('account-a');
  assert.equal(returning.searchParams.get('ext_agent_host_id'), initial.searchParams.get('ext_agent_host_id'));
  assert.equal(returning.searchParams.get('agent_name_hint'), null);
  assert.ok(returning.searchParams.get('id_token_hint'));
  assert.equal((await f.complete(returning, { clientId: 'account-a', subject: 'imposter' })).status, 400);
  state = await (await f.request('/status')).json();
  assert.equal(state.activeId, 'account-a'); assert.equal(state.connected, true);
  assert.equal((await f.complete(await f.start('account-a'), { clientId: 'different-client' })).status, 400);
});

test('refresh rotation is serialized and terminal failures clear tokens, not registration', async t => {
  const f = await fixture(t); await f.complete(await f.start(), { clientId: 'account-a' }); await f.expire();
  const responses = await Promise.all([f.request('/models'), f.request('/models')]);
  assert.ok(responses.every(r => r.status === 200)); assert.equal(f.refreshCount(), 1);
  const saved = JSON.parse(await fs.readFile(f.file));
  assert.equal(saved.accounts[0].refreshToken, 'rotated-1');
  await f.expire(); f.setRefreshError('invalid_grant');
  assert.equal((await f.request('/models')).status, 400);
  const status = await (await f.request('/status')).json();
  assert.equal(status.connected, false); assert.equal(status.accounts.length, 1);
});

test('missing plan scope blocks inference; logout revokes and preserves registration', async t => {
  const f = await fixture(t); f.setScopes('openid email');
  await f.complete(await f.start(), { clientId: 'account-a' });
  assert.equal((await (await f.request('/status')).json()).planEnabled, false);
  assert.equal((await f.request('/models')).status, 403);
  f.failRevoke();
  const status = await (await f.request('/logout', {})).json();
  assert.equal(status.connected, false); assert.match(status.warning, /未能确认/);
  const account = JSON.parse(await fs.readFile(f.file)).accounts[0];
  assert.equal(account.clientId, 'account-a'); assert.equal(account.refreshToken, undefined); assert.equal(account.idToken, undefined);
  const returning = await f.start('account-a', true);
  assert.equal(returning.searchParams.get('id_token_hint'), null);
  assert.equal(returning.searchParams.get('prompt'), 'consent');
  await f.request('/cancel', {});
  assert.equal((await (await f.request('/status')).json()).pending, false);
});

test('Codex usage requires explicit account-scoped consent; failures preserve inference login', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/usage')).status, 401);
  await f.complete(await f.start(), { clientId: 'account-a' });
  assert.equal((await f.request('/usage')).status, 409);
  assert.equal(f.usageCalls(), 0);
  assert.equal((await f.request('/usage/connect', { accountId: 'wrong-account' })).status, 409);
  assert.equal(f.usageCalls(), 0);
  assert.equal((await f.request('/usage/connect', { accountId: 'account-a' })).status, 200);
  assert.equal((await (await f.request('/status')).json()).usageConnected, true);
  const response = await f.request('/usage');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.windows[0].remainingPercent, 80);
  assert.equal(data.windows[0].resetsAt, 1900000000000);
  assert.equal(data.credits, 0);
  assert.equal(data.accountId, 'account-a');
  assert.equal(data.source, 'codex-cli');
  assert.equal(data.resetCredits, 2);
  assert.ok(!JSON.stringify(data).includes('not-for-browser'));
  for (const status of [401, 403]) {
    f.setUsageStatus(status);
    const denied = await f.request('/usage');
    assert.equal(denied.status, status);
    assert.match((await denied.json()).error, /Codex fixture/);
    assert.equal((await (await f.request('/status')).json()).connected, true);
  }
  assert.equal((await f.request('/usage/disconnect', { accountId: 'account-a' })).status, 200);
  assert.equal((await f.request('/usage')).status, 409);
  assert.equal((await (await f.request('/status')).json()).usageConnected, false);
  assert.ok(f.calls.every(call => !call.url.includes('wham')));
});

test('usage normalization distinguishes unknown, exhausted and unlimited credits', () => {
  const data = normalizeChatGPTUsage({ rate_limit: { secondary_window: { used_percent: 100, limit_window_seconds: 604800 } }, credits: { unlimited: true } });
  assert.equal(data.windows[0].label, '每周');
  assert.equal(data.windows[0].remainingPercent, 0);
  assert.equal(data.credits, 'unlimited');
  assert.throws(() => normalizeChatGPTUsage({ credits: { balance: null } }), /不能据此判断额度为零/);
  assert.throws(() => normalizeChatGPTUsage({ rate_limit: { primary_window: { used_percent: 'bad' } } }), /未返回/);
});

function loadFrontend(entry = 'chatgpt.ts') {
  const cache = new Map();
  function load(file) {
    const full = resolve(__dirname, '../src/services', file);
    if (cache.has(full)) return cache.get(full);
    const exports = {};
    const code = ts.transpileModule(readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: id => load(`${id}.ts`), fetch, Response, TextDecoder, AbortSignal, DOMException, console });
    cache.set(full, exports); return exports;
  }
  return load(entry);
}
test('Responses translation, UTF-8 streaming, usage, incomplete/failed/interrupted streams', async () => {
  const { toResponsesRequest, readProviderEvents, aiRequestBody } = loadFrontend();
  const request = toResponsesRequest({ model: 'test-model', messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }], max_tokens: 512, reasoning_effort: 'high', response_format: { type: 'json_object' }, temperature: 0.7 });
  assert.equal(request.input[0].role, 'developer'); assert.equal(request.input[1].content[1].type, 'input_image');
  assert.equal(request.temperature, undefined); assert.equal(request.max_output_tokens, 512);
  assert.equal(request.reasoning.effort, 'high'); assert.equal(request.text.format.type, 'json_object');
  const bytes = Buffer.from(events(completion));
  const response = new Response(new ReadableStream({ start(controller) { for (const b of bytes) controller.enqueue(Uint8Array.of(b)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  const output = []; for await (const event of readProviderEvents(response, 'chatgpt')) output.push(event);
  assert.equal(output[0].choices[0].delta.content, '你好'); assert.equal(output[1].usage.total_tokens, 11);
  const sse = list => new Response(events(list), { headers: { 'Content-Type': 'text/event-stream' } });
  async function consume(list) { const result = []; for await (const event of readProviderEvents(sse(list), 'chatgpt')) result.push(event); return result; }
  await assert.rejects(() => consume([completion[0]]), /未收到完成事件/);
  await assert.rejects(() => consume([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } } }]), /subscription_sharing_usage_limit_exceeded/);
  assert.equal((await consume([{ type: 'response.incomplete', response: {} }]))[0].incomplete, true);
  assert.equal(aiRequestBody('deepseek', 'old-key', { model: 'unchanged' }).headers.Authorization, 'Bearer old-key');
  assert.equal(aiRequestBody('chatgpt', '', { messages: [] }).headers.Authorization, undefined);
});

test('top-bar usage text represents remaining percentages with reset details', () => {
  const { formatChatGPTUsage } = loadFrontend('chatgptUsage.ts');
  const balance = formatChatGPTUsage({ accountId: 'a', capturedAt: 1900000000000, credits: 0, windows: [{ label: '5h', remainingPercent: 80, usedPercent: 20, resetsAt: 1900000000000 }] });
  assert.equal(balance.text, '5h 余 80%');
  assert.match(balance.detail, /重置于/);
  assert.match(balance.detail, /积分 0/);
});

test('Windows credential protection round trip (no plaintext persisted)', { skip: process.platform !== 'win32' }, async () => {
  const input = Buffer.from('{"test":"not-a-real-token"}');
  const encrypted = await protectWindows(input);
  assert.ok(!encrypted.includes(input));
  assert.deepEqual(await protectWindows(encrypted, true), input);
});
