// Hidden Electron regression: synthetic records only, no AI calls or screenshots.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const { lock, write } = require('../installer/data-storage.cjs');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.homedir(), '.pi/agent/tmp/chillpass-memory-'));
  let app;
  try {
    const data = path.join(dir, 'data'), config = path.join(dir, 'config');
    await fs.mkdir(config);
    await fs.writeFile(path.join(config, 'config.json'), JSON.stringify({ courseStorageRoot: data }));
    const memories = Array.from({ length: 271 }, (_, i) => ({ id: 'memory-' + i, type: i ? 'flow' : 'charter', content: i < 3 ? { content: '结构化记忆测试-' + i, details: ['保留全部字段'] } : '普通记忆-' + i, createdAt: 1, updatedAt: 1 }));
    const original = JSON.stringify({ state: { memories, abilities: [], model: '', thinkingMode: 'high' }, version: 0 });
    await lock(data, () => write(data, 'athena-storage', original, null));
    const chat = JSON.stringify({ version: 2, state: { currentId: 'test', conversations: [{ id: 'test', title: '独立记忆测试', courseId: null, memories, messages: [], createdAt: 1, updatedAt: 1 }] } });
    await lock(data, () => write(data, 'chillpass-chat', chat, null));
    const env = { ...process.env, CHILLPASS_DESKTOP_TEST: '1', CHILLPASS_DESKTOP_PROFILE: path.join(dir, 'profile'), CHILLPASS_CONFIG_DIR: config };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: process.env.CHILLPASS_DESKTOP_EXE || require('electron'), args: process.env.CHILLPASS_DESKTOP_EXE ? [] : [path.resolve(__dirname, '..')], env });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR:', error.message); });
    await page.locator('#root button').first().waitFor({ state: 'attached' });
    await page.evaluate(() => {
      localStorage.setItem('chillpass-settings', JSON.stringify({ version: 7, state: { storageLocationConfirmed: true } }));
      localStorage.setItem('chillpass-onboarding', JSON.stringify({ version: 0, state: { stage: 'done', forceWelcome: false } }));
      location.hash = '/chat';
    });
    await page.reload();
    await page.locator('#reload-snapshot').waitFor({ state: 'detached' });
    await page.getByTitle('记忆管理', { exact: true }).click();
    await page.waitForTimeout(500);
    assert.deepEqual(errors, []);
    await page.getByText('宪章记忆', { exact: true }).waitFor();
    await page.getByText('流动记忆', { exact: true }).waitFor();
    assert(await page.getByText(/结构化记忆测试-0/).count());
    assert(await page.getByText(/结构化记忆测试-1/).count());
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    const edited = await page.locator('textarea').evaluateAll(nodes => nodes.map(node => node.value));
    assert(edited.some(value => value.includes('结构化记忆测试-0') && value.includes('保留全部字段')));
    await page.getByRole('button', { name: '取消', exact: true }).click();
    const disk = JSON.parse(await fs.readFile(path.join(data, '_chillpass-data/athena.json'), 'utf8'));
    assert.equal(disk.value, original, 'Opening/edit-cancel must not rewrite archived global memories');
    const chatDisk = JSON.parse(await fs.readFile(path.join(data, '_chillpass-data/conversations.json'), 'utf8'));
    assert.equal(chatDisk.value, chat, 'Opening/edit-cancel must not rewrite current conversation memories');
    assert.deepEqual(errors, []);
    console.log('PASS 271 memories, object content rendering/editing, original disk records unchanged');
  } finally {
    if (app) await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
