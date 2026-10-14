'use strict';
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const BASE = 'https://opencode.ai/inference/go/v1/';
// Official route: packages/console/app/src/routes/zen/go/v1/usage.ts.
// Read-only Go quota, not the Zen PAYG balance or a model request.
const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const ROUTES = new Set(['chat/completions', 'responses', 'messages']);

// Fixed Go-only upstream: never a generic proxy or a fallback to Zen billing.
function createOpenCodeGoProxy({ fetchImpl = fetch } = {}) {
  return async function handle(req, res, path) {
    if (!path.startsWith('/api/opencode-go/')) return false;
    const controller = new AbortController(); let timer;
    const stop = () => controller.abort();
    const touch = () => { clearTimeout(timer); timer = setTimeout(stop, 90000); };
    res.on('close', stop); touch();
    const fail = (message, status) => { throw Object.assign(new Error(message), { publicStatus: status }); };
    try {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
        || !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(req.headers.host || '')
        || req.headers['x-chillpass-client'] !== '1'
        || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
        || req.headers['sec-fetch-site'] === 'cross-site') fail('OpenCode Go 仅允许由本机 ChillPass 调用。', 403);
      const endpoint = path.slice('/api/opencode-go/'.length);
      const isUsage = endpoint === 'usage';
      if (!isUsage && !ROUTES.has(endpoint)) fail('不支持的 Go 接口。', 404);
      if (req.method !== (isUsage ? 'GET' : 'POST')) fail(isUsage ? '额度查询仅支持 GET 请求。' : '仅支持 POST 请求。', 405);
      const key = endpoint === 'messages' ? req.headers['x-api-key'] : req.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (typeof key !== 'string' || !key.trim() || key.length > 16384) fail('请填写 OpenCode Go 套餐 API Key。', 401);
      if (isUsage) {
        // Fixed destination + no redirects: never forward a key to a user-supplied URL.
        clearTimeout(timer); timer = setTimeout(stop, 15000);
        const upstream = await fetchImpl(USAGE_URL, {
          method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${key.trim()}` },
          redirect: 'error', cache: 'no-store', signal: controller.signal,
        });
        if (!upstream.ok) {
          await upstream.body?.cancel();
          if (upstream.status === 401) fail('OpenCode Go API Key 验证失败，请检查配置。', 401);
          if (upstream.status === 403) fail('OpenCode 未允许此 Key 查询 Go 额度，请在官方控制台检查套餐和工作区；这不一定影响模型调用。', 403);
          if (upstream.status === 429) fail('OpenCode Go 额度查询过于频繁，请稍后重试。', 429);
          fail(`OpenCode Go 额度接口暂不可用（HTTP ${upstream.status}），请稍后重试或前往官方控制台。`, 502);
        }
        if (!upstream.body) fail('OpenCode Go 额度接口返回空响应。', 502);
        const parts = []; let bytes = 0;
        for await (const part of upstream.body) {
          bytes += part.length;
          if (bytes > 65536) fail('OpenCode Go 额度响应过大，已停止读取。', 502);
          parts.push(part);
        }
        let data;
        try { data = JSON.parse(Buffer.concat(parts).toString('utf8')); }
        catch { fail('OpenCode Go 额度接口未返回有效 JSON，请稍后重试。', 502); }
        // Do not forward upstream error bodies, headers, or credentials to the UI.
        if (!data?.usage || typeof data.usage !== 'object' || Array.isArray(data.usage)) {
          fail('OpenCode Go 额度接口未返回可识别的用量数据，请查看官方控制台。', 502);
        }
        const usage = {};
        for (const name of ['rolling', 'weekly', 'monthly']) {
          const value = data.usage[name];
          if (value && typeof value === 'object') {
            usage[name] = { percent: value.percent, resetsAt: value.resetsAt, status: value.status };
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ usage }));
        return true;
      }
      const sessionId = req.headers['x-opencode-session'];
      if (sessionId !== undefined && (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId))) fail('无效的 Go 会话 ID。', 400);
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 24 * 1024 * 1024) fail('请求超过 24 MB，请减少附件。', 413);
        chunks.push(chunk);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString()); } catch { fail('无效的 JSON 请求。', 400); }
      if (!payload || typeof payload !== 'object' || typeof payload.model !== 'string' || !payload.model.trim()) fail('缺少 Go 模型。', 400);
      payload.stream = true;
      if (endpoint === 'responses') payload.store = false;
      // Preserve conversation affinity for all protocols; older clients get a per-request fallback.
      const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-opencode-session': sessionId || randomUUID() };
      if (endpoint === 'messages') { headers['x-api-key'] = key.trim(); headers['anthropic-version'] = '2023-06-01'; }
      else headers.Authorization = `Bearer ${key.trim()}`;
      const upstream = await fetchImpl(BASE + endpoint, { method: 'POST', headers, body: JSON.stringify(payload), redirect: 'error', signal: controller.signal });
      if (!upstream.body) fail('Go 返回了空响应。', 502);
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no',
        ...(upstream.headers.get('retry-after') ? { 'Retry-After': upstream.headers.get('retry-after') } : {}),
      });
      for await (const chunk of upstream.body) {
        touch(); if (!res.write(chunk)) await once(res, 'drain', { signal: controller.signal });
      }
      res.end();
    } catch (error) {
      if (res.headersSent) res.destroy();
      else if (!res.destroyed) {
        res.writeHead(error.publicStatus || 502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: { message: error.publicStatus ? error.message : 'OpenCode Go 连接失败或超时，请检查网络与套餐状态。' } }));
      }
    } finally { clearTimeout(timer); controller.abort(); res.off('close', stop); }
    return true;
  };
}
module.exports = { createOpenCodeGoProxy };
