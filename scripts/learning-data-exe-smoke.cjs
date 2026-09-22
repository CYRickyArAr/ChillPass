const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const assert = require('node:assert/strict');
(async () => {
  const parent = path.resolve('output/learning-data-exe-smoke');
  await fs.mkdir(parent, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(parent, 'run-'));
  const config = path.join(fixture, 'config'), root = path.join(fixture, 'data');
  await fs.mkdir(config);
  // Never let the test executable point at real Documents/ChillPass.
  await fs.writeFile(path.join(config, 'config.json'), JSON.stringify({ courseStorageRoot: root, previousStorageRoots: [] }));
  const listener = net.createServer().listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(r => listener.close(r));
  const exe = path.resolve(process.argv[2] || 'build/sea/chillpass.exe');
  const sourceMode = exe.endsWith('.mjs');
  let child;
  const url = `http://127.0.0.1:${port}`;
  const request = async body => {
    const response = await fetch(url + '/api/learningData', { method: body ? 'POST' : 'GET', headers: { 'X-ChillPass-Data': '1', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 200); return response.json();
  };
  const start = async () => {
    child = spawn(sourceMode ? process.execPath : exe, sourceMode ? [exe] : [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, CHILLPASS_APP_DIR: process.cwd(), CHILLPASS_CONFIG_DIR: config, CHILLPASS_PORT: String(port), CHILLPASS_NO_UI: '1' } });
    let failure; child.on('error', e => { failure = e });
    for (let i = 0; i < 100; i++) {
      if (failure) throw failure;
      try { const response = await fetch(url + '/api/getAppVersion', { signal: AbortSignal.timeout(300) }); if (response.ok) return; } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    throw Error('Executable did not start');
  };
  const stop = async () => { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } };
  try {
    await start(); const snapshot = await request(); assert.equal(snapshot.root, root);
    const value = JSON.stringify({ state: { courses: [{ id: 'fixture', name: '测试课程' }] }, version: 2 });
    await request({ root, key: 'chillpass-course-v2', value, expectedRevision: null });
    await stop(); await start(); assert.equal((await request()).entries['chillpass-course-v2'].value, value);
    const response = await fetch(url + '/'); assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('ChillPass'));
    console.log(JSON.stringify({ passed: true, backend: sourceMode ? 'source' : 'exe', restartRestoresData: true, fixture }));
  } finally { await stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
