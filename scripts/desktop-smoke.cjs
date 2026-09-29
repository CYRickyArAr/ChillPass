// Real Electron, hidden window, isolated data/profile. No screenshots or paid AI requests.
// Uses the project's Playwright dev dependency and Electron runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const { externalUrl, allowedRequest, isAppUrl } = require('../desktop/security.cjs');
const { selectUpdate } = require('../desktop/updates.cjs');
const { lock, write } = require('../installer/data-storage.cjs');

async function main() {
  assert(isAppUrl('chillpass://app/'));
  assert(!isAppUrl('chillpass://other/'));
  assert.equal(externalUrl('file:///C:/Windows/notepad.exe'), null);
  assert.equal(externalUrl('javascript:alert(1)'), null);
  assert(!allowedRequest('chillpass://app/api/startUpdate', 'POST'));
  assert(!allowedRequest('chillpass://app/desktop/main.cjs', 'GET'));
  assert(allowedRequest('chillpass://app/api/learningData', 'POST'));
  const asset = { name: 'ChillPass-Setup-9.0.0.exe', browser_download_url: 'https://github.com/CYRickyArAr/ChillPass/releases/download/v9.0.0/ChillPass-Setup-9.0.0.exe' };
  assert(selectUpdate({ tag_name: 'v9.0.0', assets: [asset] }, '0.2.0'));
  assert.equal(selectUpdate({ tag_name: 'v9.0.0', assets: [] }, '0.2.0'), null);
  assert.equal(selectUpdate({ tag_name: 'v0.2.0', assets: [asset] }, '0.2.0'), null);
  assert.equal(selectUpdate({ tag_name: 'v9.0.0', prerelease: true, assets: [asset] }, '0.2.0'), null);

  const tempRoot = process.env.CHILLPASS_SMOKE_ROOT || path.join(os.homedir(), '.pi', 'agent', 'tmp');
  await fs.mkdir(tempRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(tempRoot, 'chillpass-desktop-'));
  const dataRoot = path.join(dir, '学习资料');
  const configDir = path.join(dir, 'config');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'config.json'), JSON.stringify({ courseStorageRoot: dataRoot }));
  const value = JSON.stringify({ version: 2, state: {
    currentCourseId: 'smoke-course', courses: [{
      course: { id: 'smoke-course', name: '桌面验证课程', files: [], status: 'ready', createdAt: 1, updatedAt: 1 },
      rawText: '', examPoints: [{ id: 'point', title: '桌面测试知识点', priority: 'know', description: '测试' }],
      lessons: [{ id: 'smoke-lesson', courseId: 'smoke-course', order: 1, title: '桌面测试知识点', examPointId: 'point', priority: 'know', status: 'available', content: {
        keyPoints: ['公式 $C=2B\\log_{2}M$'], explanation: '独立桌面窗口测试', examples: [],
        quiz: [{ id: 'question', type: 'choice', question: '桌面保存测试', options: ['正确选项', '错误选项'], correctIndex: 0, explanation: '测试用正确答案' }],
      } }],
      progress: { totalLessons: 1, completedLessons: 0, currentStreak: 0 },
      generatingLessons: false, generationProgress: { current: 1, total: 1 },
      preparationProgress: { stage: 'idle', current: 0, total: 0 },
    }],
  } });
  await lock(dataRoot, () => write(dataRoot, 'chillpass-course-v2', value, null));
  const root = path.resolve(__dirname, '..');
  const executablePath = process.env.CHILLPASS_DESKTOP_EXE || require('electron');
  const env = { ...process.env, CHILLPASS_DESKTOP_TEST: '1', CHILLPASS_DESKTOP_PROFILE: path.join(dir, 'profile'), CHILLPASS_CONFIG_DIR: configDir };
  delete env.ELECTRON_RUN_AS_NODE;
  let electronApp;
  const launch = () => _electron.launch({ executablePath, args: process.env.CHILLPASS_DESKTOP_EXE ? [] : [root], env, timeout: 30000 });
  try {
    electronApp = await launch();
    let page = await electronApp.firstWindow();
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.body.textContent.includes('桌面验证课程'), { timeout: 20000 });
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => window.electronAPI.platform), 'desktop');
    const preferences = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    const address = await electronApp.evaluate(({ app }) => {
      const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      return require('./installer/app.cjs').server.address();
    });
    assert.equal(address.address, '127.0.0.1');
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/getAppVersion`)).status, 403);
    const api = await page.evaluate(async () => {
      const response = await fetch('/api/getCourseStorageRoot');
      return { status: response.status, data: await response.json() };
    });
    assert.equal(api.status, 200);
    assert.equal(api.data.path, dataRoot);
    assert.equal(await page.evaluate(async () => (await fetch('/api/startUpdate', { method: 'POST' })).status), 403);
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('chillpass-settings')) || { version: 7, state: {} };
      settings.state.storageLocationConfirmed = true;
      localStorage.setItem('chillpass-settings', JSON.stringify(settings));
      localStorage.setItem('desktop-smoke-marker', 'persistent');
      location.hash = '/lessons/smoke-lesson';
    });
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForSelector('.katex');
    console.log('Desktop window, persisted course and math loaded');
    assert.equal(await page.locator('.katex annotation').first().textContent(), 'C=2B\\log_{2}M');
    const file = await page.evaluate(async () => {
      const params = new URLSearchParams({ courseName: '桌面验证课程', fileName: '中文课件.txt' });
      const text = 'ChillPass 本地课件';
      const response = await fetch('/api/storeCourseFile?' + params, { method: 'POST', body: new TextEncoder().encode(text) });
      const meta = await response.json();
      const saved = await fetch('/api/readFile?' + new URLSearchParams({ path: meta.path }));
      return { status: response.status, content: await saved.text() };
    });
    assert.deepEqual(file, { status: 200, content: 'ChillPass 本地课件' });
    // Simulate a disk service failure; native close must not discard the queued quiz state.
    await electronApp.evaluate(({ app, dialog }) => {
      const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const server = require('./installer/app.cjs').server;
      const listeners = server.listeners('request');
      const showMessageBox = dialog.showMessageBox;
      globalThis.desktopSmokeWarnings = [];
      dialog.showMessageBox = async (_win, options) => {
        globalThis.desktopSmokeWarnings.push(options.message);
        return { response: 0 };
      };
      server.removeAllListeners('request');
      server.on('request', (req, res) => {
        if (req.url === '/api/learningData' && req.method === 'POST') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'simulated save failure' }));
        } else for (const listener of listeners) listener(req, res);
      });
      globalThis.desktopSmokeRestore = () => {
        server.removeAllListeners('request');
        for (const listener of listeners) server.on('request', listener);
        dialog.showMessageBox = showMessageBox;
      };
    });
    await page.getByRole('button', { name: /^小测/ }).click();
    await page.evaluate(() => { window.electronAPI.windowClose(); });
    for (let i = 0; i < 50; i++) {
      if (await electronApp.evaluate(() => globalThis.desktopSmokeWarnings.length > 0)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(await electronApp.evaluate(() => globalThis.desktopSmokeWarnings.some(text => text.includes('取消退出'))));
    assert.equal(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    await electronApp.evaluate(() => globalThis.desktopSmokeRestore());
    // Successful close now flushes the real course/quiz changes, including the retained queue.
    await page.getByRole('button', { name: /正确选项/ }).click();
    await page.getByRole('button', { name: '完成关卡', exact: true }).click();
    await page.evaluate(() => localStorage.setItem('desktop-close-marker', 'saved'));
    const closed = electronApp.waitForEvent('close');
    await page.evaluate(() => { window.electronAPI.windowClose(); });
    await closed;
    electronApp = null;
    const diskCourse = JSON.parse(await fs.readFile(path.join(dataRoot, '_chillpass-data', 'courses.json'), 'utf8'));
    assert.equal(JSON.parse(diskCourse.value).state.courses[0].progress.completedLessons, 1);
    assert(await fs.readFile(path.join(dataRoot, '_chillpass-data', 'quiz-progress.json'), 'utf8'));
    await assert.rejects(() => fetch(`http://127.0.0.1:${address.port}/api/getAppVersion`));
    electronApp = await launch();
    page = await electronApp.firstWindow();
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    await page.waitForFunction(() => document.body.textContent.includes('桌面验证课程'), { timeout: 20000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('desktop-smoke-marker')), 'persistent');
    assert.equal(await page.evaluate(() => localStorage.getItem('desktop-close-marker')), 'saved');
    assert.deepEqual(errors, []);
    const closedAgain = electronApp.waitForEvent('close');
    await page.evaluate(() => { window.electronAPI.windowClose(); });
    await closedAgain;
    electronApp = null;
    console.log('PASS desktop: existing disk data, secure renderer, private backend, files, formulas, close cleanup and restart persistence');
  } finally {
    if (electronApp) {
      await electronApp.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.destroy(); }).catch(() => {});
      await electronApp.close().catch(() => {});
    }
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 });
