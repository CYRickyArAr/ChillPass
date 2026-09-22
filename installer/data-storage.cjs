'use strict';
// Shared by Vite and the portable backend; embedded into the SEA at build time.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const FILES = {
  'chillpass-course-v2': 'courses.json',
  'chillpass-quiz-progress-v1': 'quiz-progress.json',
  'chillpass-wrong-questions': 'wrong-questions.json',
  'chillpass-chat': 'conversations.json',
  'chillpass-chat-current': 'current-conversation.json',
  'athena-storage': 'athena.json',
};
const hash = text => createHash('sha256').update(text).digest('hex');
const dirFor = root => path.join(root, '_chillpass-data');
function error(message, status = 409) { return Object.assign(new Error(message), { status }); }
async function read(root, key) {
  let text;
  try { text = await fs.readFile(path.join(dirFor(root), FILES[key]), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const entry = JSON.parse(text);
  if (entry.format !== 1 || entry.key !== key || typeof entry.revision !== 'string' ||
      (entry.value !== null && typeof entry.value !== 'string') || entry.sha256 !== hash(JSON.stringify(entry.value))) {
    throw error(`数据校验失败：${FILES[key]}。原文件未覆盖，请从 backups 恢复。`, 422);
  }
  return entry;
}
async function lock(root, task) {
  const dir = dirFor(root);
  await fs.mkdir(dir, { recursive: true });
  const lockPath = path.join(dir, '.write-lock');
  let acquired = false;
  for (let i = 0; i < 100; i++) {
    try { await fs.mkdir(lockPath); acquired = true; break; }
    catch (e) { if (e.code !== 'EEXIST') throw e; await new Promise(r => setTimeout(r, 30)); }
  }
  if (!acquired) throw error('数据目录正在写入或有未清理的写入锁。请退出其他 ChillPass 实例后重试；不要覆盖数据。', 423);
  try { return await task(); } finally { await fs.rmdir(lockPath); }
}
async function backup(root, name, bytes) {
  const dir = path.join(dirFor(root), 'backups');
  await fs.mkdir(dir, { recursive: true });
  const destination = path.join(dir, `${Date.now()}-${randomUUID()}-${name}`);
  await fs.writeFile(destination, bytes, { flag: 'wx' });
  if (await fs.readFile(destination, 'utf8') !== bytes) throw error('备份校验失败', 500);
}
async function write(root, key, value, expectedRevision) {
  if (!Object.hasOwn(FILES, key)) throw error('不支持的数据类型', 400);
  if (value !== null && typeof value !== 'string') throw error('数据必须为字符串或 null', 400);
  if (value !== null && key !== 'chillpass-chat-current') {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed.state !== 'object' || parsed.state === null) throw error('无效的存储数据', 400);
  }
  const old = await read(root, key);
  if (old && old.value === value) return old;
  if ((old?.revision ?? null) !== expectedRevision) throw error('硬盘数据已被其他窗口修改。当前修改已保留在浏览器待保存队列，请勿强制覆盖。');
  const entry = { format: 1, key, value, revision: randomUUID(), sha256: hash(JSON.stringify(value)), savedAt: new Date().toISOString() };
  const destination = path.join(dirFor(root), FILES[key]);
  if (old) await backup(root, FILES[key], await fs.readFile(destination, 'utf8'));
  const temp = `${destination}.${randomUUID()}.tmp`;
  const bytes = JSON.stringify(entry);
  const handle = await fs.open(temp, 'wx');
  try { await handle.writeFile(bytes, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  try {
    if (await fs.readFile(temp, 'utf8') !== bytes) throw error('写入校验失败', 500);
    await fs.rename(temp, destination);
    return await read(root, key);
  } finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
async function migrateRoot(oldRoot, newRoot, commit) {
  if (path.resolve(oldRoot).toLowerCase() === path.resolve(newRoot).toLowerCase()) return commit();
  const roots = [oldRoot, newRoot].sort();
  return lock(roots[0], () => lock(roots[1], async () => {
    const copies = [];
    for (const key of Object.keys(FILES)) {
      const old = await read(oldRoot, key), target = await read(newRoot, key);
      if (target && (!old || target.value !== old.value)) throw error('目标目录已有不同的学习数据，请选择空目录。旧目录和目标数据均未覆盖。');
      if (old) copies.push([key, old, target]);
    }
    for (const [key, old, target] of copies) {
      // Keep revisions so pending requests can safely continue after the path change.
      if (target) await backup(newRoot, FILES[key], await fs.readFile(path.join(dirFor(newRoot), FILES[key]), 'utf8'));
      await fs.copyFile(path.join(dirFor(oldRoot), FILES[key]), path.join(dirFor(newRoot), FILES[key]));
      if ((await read(newRoot, key)).revision !== old.revision) throw error('目录迁移校验失败', 500);
    }
    await commit();
  }));
}
function createDataStorage(getRoot) {
  return async (req, res, pathname) => {
    if (pathname !== '/api/learningData') return false;
    const respond = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers['x-chillpass-data'] !== '1' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) throw error('禁止跨站数据访问', 403);
      if (req.method === 'GET') {
        const root = getRoot();
        const result = await lock(root, async () => {
          const entries = {};
          for (const key of Object.keys(FILES)) entries[key] = await read(root, key);
          return { root, entries };
        });
        respond(200, result);
      } else if (req.method === 'POST') {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 150 * 1024 * 1024) throw error('数据过大', 413); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const root = getRoot();
        if (body.root !== root) throw error('数据存储目录已更改，请刷新后重试。');
        const result = await lock(root, async () => {
          if (root !== getRoot()) throw error('数据存储目录已更改，请刷新后重试。');
          if (body.backup) {
            await backup(root, 'browser-migration.json', JSON.stringify(body.backup));
            return { backedUp: true };
          }
          return write(root, body.key, body.value, body.expectedRevision);
        });
        respond(200, result);
      } else respond(405, { error: 'Method not allowed' });
    } catch (e) { respond(e.status || 500, { error: e.message }); }
    return true;
  };
}
module.exports = { createDataStorage, migrateRoot, FILES, read, lock, write };
