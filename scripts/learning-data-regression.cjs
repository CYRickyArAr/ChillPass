const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createServer } = require('node:http');
const { once } = require('node:events');
const vm = require('node:vm');
const ts = require('typescript');
const disk = require('../installer/data-storage.cjs');
const wrap = state => JSON.stringify({ state, version: 1 });
(async () => {
  const parent = path.resolve('output/learning-data-tests');
  await fs.mkdir(parent, { recursive: true });
  const dir = await fs.mkdtemp(path.join(parent, 'run-'));
  let root = path.join(dir, '原目录');
  const api = disk.createDataStorage(() => root);
  const server = createServer((req, res) => { void api(req, res, '/api/learningData'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  let checks = 0;
  const check = text => { checks++; console.log('PASS ' + text); };
  const timers = new Set();
  function browser(seed = {}) {
    const local = new Map(Object.entries(seed));
    const ctx = {
      exports: {}, AbortSignal, Map, JSON, Error,
      localStorage: { getItem: k => local.get(k) ?? null, setItem: (k, v) => local.set(k, v), removeItem: k => local.delete(k) },
      fetch: (_, options) => fetch(url, options),
      setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; }, clearTimeout,
      window: { addEventListener() {} }, document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {} }), body: { appendChild() {} }, addEventListener() {} },
    };
    const source = require('node:fs').readFileSync('src/services/learningDataStorage.ts', 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
    return { ...ctx.exports, local };
  }
  const key = 'chillpass-course-v2';
  try {
    const a = browser({ [key]: wrap({ courses: [{ id: '课程1', rawText: '中文课件' }] }), 'chillpass-chat': wrap({ conversations: [] }), 'chillpass-settings': 'private-key-do-not-copy' });
    await a.initializeLearningData();
    assert.equal((await disk.read(root, key)).value, a.local.get(key));
    const backups = await fs.readdir(path.join(root, '_chillpass-data/backups'));
    assert.ok(backups.some(f => f.endsWith('browser-migration.json')));
    assert.ok(!(await fs.readFile(path.join(root, '_chillpass-data/backups', backups[0]), 'utf8')).includes('private-key-do-not-copy'));
    check('legacy browser data imported after backup; API key excluded');
    const b = browser(); await b.initializeLearningData();
    assert.equal(b.learningDataStorage.getItem(key), a.learningDataStorage.getItem(key));
    check('fresh browser restores disk data');
    a.learningDataStorage.setItem(key, wrap({ courses: ['updated'] })); await a.flushLearningData();
    assert.ok((await disk.read(root, key)).value.includes('updated'));
    assert.ok((await fs.readdir(path.join(root, '_chillpass-data/backups'))).some(f => f.endsWith('courses.json')));
    check('save persists with previous-version backup');
    b.learningDataStorage.setItem(key, wrap({ courses: ['stale-conflict'] }));
    await assert.rejects(b.flushLearningData(), /其他窗口/);
    assert.ok((await disk.read(root, key)).value.includes('updated'));
    assert.ok(b.local.has('chillpass-disk-pending:' + key));
    check('stale writer blocked and pending data retained');
    const c = browser(); await c.initializeLearningData();
    const previous = await disk.read(root, key);
    const next = wrap({ courses: ['resume-after-close'] });
    const resumed = browser({ ['chillpass-disk-pending:' + key]: JSON.stringify({ value: next, root, expectedRevision: previous.revision }) });
    await resumed.initializeLearningData();
    assert.equal((await disk.read(root, key)).value, next);
    check('unsaved queue resumes after restart');
    await assert.rejects(disk.lock(root, () => disk.write(root, '../../escape', '{}', null)), /不支持/);
    check('path traversal / unsupported keys rejected');
    const origin = await fetch(url, { headers: { 'X-ChillPass-Data': '1', Origin: 'https://evil.example' } });
    assert.equal(origin.status, 403); check('cross-origin access rejected');
    const target = path.join(dir, '目标目录');
    const oldRoot = root;
    await disk.migrateRoot(root, target, async () => { root = target; });
    assert.equal((await disk.read(root, key)).value, next);
    assert.equal((await disk.read(oldRoot, key)).value, next);
    check('directory migration copies verified state and preserves source');
    const conflict = path.join(dir, '已存在其他数据');
    await disk.lock(conflict, () => disk.write(conflict, key, wrap({ courses: ['another'] }), null));
    await assert.rejects(disk.migrateRoot(root, conflict, async () => { throw Error('must not commit'); }), /不同/);
    assert.ok((await disk.read(conflict, key)).value.includes('another')); check('conflicting target never overwritten');
    const d = browser(); await d.initializeLearningData();
    d.learningDataStorage.removeItem(key); await d.flushLearningData();
    const restoreOldBrowser = browser({ [key]: next }); await restoreOldBrowser.initializeLearningData();
    assert.equal(restoreOldBrowser.learningDataStorage.getItem(key), null);
    check('deletion tombstone prevents legacy browser resurrection');
    const switchedRoot = path.join(dir, '切换中仍有修改');
    await restoreOldBrowser.changeLearningDataRoot(async () => {
      restoreOldBrowser.learningDataStorage.setItem(key, wrap({ courses: ['edited during move'] }));
      await disk.migrateRoot(root, switchedRoot, async () => { root = switchedRoot; });
      return root;
    });
    await restoreOldBrowser.flushLearningData();
    assert.ok((await disk.read(root, key)).value.includes('edited during move'));
    check('changes during directory migration resume in new root');
    const file = path.join(root, '_chillpass-data/courses.json');
    await fs.copyFile(file, file + '.test-backup');
    await fs.writeFile(file, '{broken');
    const broken = browser({ [key]: next }); await assert.rejects(broken.initializeLearningData());
    assert.equal(await fs.readFile(file, 'utf8'), '{broken'); check('corrupt disk blocks startup without overwriting');
    console.log(JSON.stringify({ passed: true, checks, fixture: dir }));
  } finally { for (const timer of timers) clearTimeout(timer); server.closeAllConnections(); await new Promise(r => server.close(r)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
