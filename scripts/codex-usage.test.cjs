'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { queryCodexUsage, translateSnapshot } = require('../installer/codex-usage.cjs');

function fixture({ email = 'same@example.test', malformed = false, hang = false } = {}) {
  const methods = []; let killed = false;
  const spawnImpl = (_file, args, options) => {
    assert.equal(options.shell, false);
    assert.equal(args[0], 'app-server');
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { killed = true; queueMicrotask(() => child.emit('exit', 0)); };
    child.stdin.on('data', chunk => {
      for (const line of chunk.toString().trim().split('\n')) {
        const request = JSON.parse(line); methods.push(request.method);
        if (!request.id || hang) continue;
        let result = {};
        if (request.method === 'account/read') result = { account: { type: 'chatgpt', email, planType: 'plus' } };
        if (request.method === 'account/rateLimits/read') result = { accountId: 'workspace-a', rateLimits: { primary: { usedPercent: 8, windowDurationMins: 10080, resetsAt: 1900000000 } }, rateLimitResetCredits: { availableCount: 2 } };
        queueMicrotask(() => child.stdout.write(malformed ? 'not-json\n' : `${JSON.stringify({ id: request.id, result })}\n`));
      }
    });
    return child;
  };
  return { methods, killed: () => killed, options: { executable: 'fixture', spawnImpl, expectedEmail: 'same@example.test' } };
}

test('official CLI adapter only calls initialize/account/quota methods and closes its process', async () => {
  const f = fixture(); const result = await queryCodexUsage(f.options);
  assert.deepEqual(f.methods, ['initialize', 'initialized', 'account/read', 'account/rateLimits/read', 'account/read']);
  assert.equal(result.payload.rate_limit.primary_window.used_percent, 8);
  assert.equal(result.payload.rate_limit.primary_window.limit_window_seconds, 604800);
  assert.equal(result.resetCredits, 2);
  assert.equal(f.killed(), true);
});

test('mismatched account never makes a quota request; workspace changes are rejected', async () => {
  const f = fixture({ email: 'other@example.test' });
  await assert.rejects(queryCodexUsage(f.options), /账号不一致/);
  assert.ok(!f.methods.includes('account/rateLimits/read'));
  assert.equal(f.killed(), true);
  await assert.rejects(queryCodexUsage({ ...fixture().options, expectedWorkspaceId: 'another-workspace' }), /工作区已变化/);
});

test('cancelled and malformed RPC sessions terminate instead of hanging', async () => {
  const f = fixture({ hang: true }), controller = new AbortController();
  const pending = queryCodexUsage({ ...f.options, signal: controller.signal });
  controller.abort(); await assert.rejects(pending, /取消/); assert.equal(f.killed(), true);
  const bad = fixture({ malformed: true }); await assert.rejects(queryCodexUsage(bad.options), /无效/); assert.equal(bad.killed(), true);
});

test('reset credits omit expired/redeemed entries and preserve unknown vs zero', () => {
  const data = { rateLimits: {}, rateLimitResetCredits: { availableCount: 99, credits: [
    { status: 'available', expiresAt: Date.now() / 1000 + 3600 },
    { status: 'available', expiresAt: null },
    { status: 'available', expiresAt: 1 },
    { status: 'redeemed', expiresAt: null },
  ] } };
  assert.equal(translateSnapshot(data).resetCredits, 2);
  assert.equal(translateSnapshot({ rateLimits: {} }).resetCredits, null);
  assert.equal(translateSnapshot({ rateLimits: {}, rateLimitResetCredits: { availableCount: 0 } }).resetCredits, 0);
});
