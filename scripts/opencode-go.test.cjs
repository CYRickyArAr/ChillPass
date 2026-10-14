const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createServer } = require('node:http');
const { createOpenCodeGoProxy } = require('../installer/opencode-go.cjs');
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const exports = {}; cache.set(name, exports);
  const source = fs.readFileSync(path.join(__dirname, '../src/services', `${name}.ts`), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports, require: file => load(file.replace('./', '')), Response, TextDecoder, DOMException, AbortSignal,
  });
  return exports;
}
const go = load('opencodeGo'), transport = load('chatgpt');
function sse(events) { return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } }); }
async function collect(response, model) { const events = []; for await (const event of transport.readProviderEvents(response, 'opencode-go', undefined, model)) events.push(event); return events; }

test('Go local proxy streams only to fixed official endpoints and rejects cross-origin callers', async t => {
  const calls = [];
  const handler = createOpenCodeGoProxy({ fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return sse([{ choices: [{ delta: { content: 'fixture' } }] }]);
  } });
  const server = createServer((req, res) => { void handler(req, res, new URL(req.url, 'http://localhost').pathname); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/opencode-go/`;
  const request = (endpoint, headers = {}) => fetch(base + endpoint, { method: 'POST', headers: { 'X-ChillPass-Client': '1', 'Content-Type': 'application/json', Authorization: 'Bearer fixture-key', 'x-api-key': 'fixture-messages-key', ...headers }, body: JSON.stringify({ model: 'fixture-model', stream: false, store: true, endpoint: 'https://untrusted.invalid' }) });
  for (const endpoint of ['chat/completions', 'responses', 'messages']) {
    const response = await request(endpoint);
    assert.equal(response.status, 200); assert.match(await response.text(), /fixture/);
    const { url, init } = calls.at(-1);
    assert.equal(url, `https://opencode.ai/inference/go/v1/${endpoint}`);
    assert.equal(init.redirect, 'error'); assert.equal(JSON.parse(init.body).stream, true);
    assert.equal(init.headers['X-ChillPass-Client'], undefined);
    if (endpoint === 'messages') assert.equal(init.headers['x-api-key'], 'fixture-messages-key');
    else assert.equal(init.headers.Authorization, 'Bearer fixture-key');
    if (endpoint === 'responses') assert.equal(JSON.parse(init.body).store, false);
  }
  assert.equal((await request('responses', { Origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await request('responses', { 'X-ChillPass-Client': '' })).status, 403);
  assert.equal((await request('responses', { Authorization: '' })).status, 401);
  assert.equal((await request('unknown')).status, 404);
  assert.equal(calls.length, 3);
});

test('Go uses the subscription base and an explicit model/protocol map', () => {
  assert.equal(go.OPENCODE_GO_BASE_URL, 'https://opencode.ai/inference/go/v1');
  assert.equal(go.opencodeGoProtocol('glm-5.3-flash'), 'chat/completions');
  assert.equal(go.opencodeGoProtocol('gpt-6-luna'), 'responses');
  assert.equal(go.opencodeGoProtocol('minimax-m3'), 'messages');
  assert.throws(() => go.opencodeGoProtocol('unknown-model'), /尚未适配/);
  assert.equal(new Set(go.OPENCODE_GO_MODELS).size, go.OPENCODE_GO_MODELS.length);
});

test('Go request adapters use the right auth and payload, leaving API-key and ChatGPT modes intact', () => {
  const chat = { model: 'glm-5.3-flash', messages: [{ role: 'system', content: 'instruction' }, { role: 'user', content: 'hello' }], max_tokens: 100, stream: true };
  const compatible = transport.aiRequestBody('opencode-go', 'fixture-key', chat);
  assert.equal(compatible.headers.Authorization, 'Bearer fixture-key');
  assert.equal(JSON.parse(compatible.body).messages[0].role, 'system');
  const responses = transport.aiRequestBody('opencode-go', 'fixture-key', { ...chat, model: 'gpt-6-luna' });
  assert.equal(JSON.parse(responses.body).input[0].role, 'developer');
  assert.equal(responses.headers['X-ChillPass-Client'], '1');
  const messages = transport.aiRequestBody('opencode-go', 'fixture-key', { ...chat, model: 'minimax-m3' });
  const payload = JSON.parse(messages.body);
  assert.equal(messages.headers['x-api-key'], 'fixture-key');
  assert.equal(messages.headers['anthropic-version'], '2023-06-01');
  assert.equal(payload.system[0].text, 'instruction');
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.max_tokens, 100);
  assert.equal(payload.stream, true);
  assert.equal(transport.aiRequestBody('deepseek', 'key', chat).body, JSON.stringify(chat));
  assert.equal(transport.aiRequestBody('chatgpt', '', chat).headers['X-ChillPass-Client'], '1');
});

test('Messages SSE normalizes text and terminal usage; truncated/interrupted streams remain errors', async () => {
  const start = { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 5 } } };
  const events = await collect(sse([start, { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }, { type: 'message_stop' }]), 'minimax-m3');
  assert.equal(events.find(e => e.choices?.[0]?.delta)?.choices[0].delta.content, '你好');
  assert.equal(events.at(-1).usage.total_tokens, 18);
  assert.equal(events.at(-1).incomplete, false);
  const truncated = await collect(sse([start, { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, { type: 'message_stop' }]), 'minimax-m3');
  assert.equal(truncated.at(-1).incompleteReason, 'max_output_tokens');
  await assert.rejects(collect(sse([start]), 'minimax-m3'), /响应中断/);
  const responses = await collect(sse([{ type: 'response.output_text.delta', delta: 'OK' }, { type: 'response.completed', response: { usage: { input_tokens: 2, output_tokens: 1 } } }]), 'gpt-6-luna');
  assert.equal(responses[0].choices[0].delta.content, 'OK');
  assert.equal(responses.at(-1).usage.total_tokens, 3);
});

test('Messages image conversion preserves inline image data without OpenAI-only fields', () => {
  const payload = go.toGoMessagesRequest({ model: 'minimax-m3', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] }] });
  assert.equal(payload.messages[0].content[0].source.type, 'base64');
  assert.equal(payload.messages[0].content[0].source.data, 'YQ==');
  assert.equal(payload.messages[0].content[0].image_url, undefined);
});
