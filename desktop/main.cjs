'use strict';
const { app, BrowserWindow, Menu, protocol, ipcMain, dialog, shell, session } = require('electron');
const path = require('node:path');
const { existsSync } = require('node:fs');
const { randomBytes, randomUUID } = require('node:crypto');
const { APP_URL, isAppUrl, externalUrl, allowedRequest } = require('./security.cjs');
const { checkForUpdates } = require('./updates.cjs');

app.setName('ChillPass');
app.setPath('userData', process.env.CHILLPASS_DESKTOP_PROFILE || path.join(app.getPath('appData'), 'ChillPass Desktop'));
protocol.registerSchemesAsPrivileged([{ scheme: 'chillpass', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);
const acquiredLock = app.requestSingleInstanceLock();
let mainWindow, backend, backendUrl;
let allowClose = false, closing = null, quitting = false;
const token = randomBytes(32).toString('hex');
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob:; font-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self' https: http:; worker-src 'self' blob:; frame-src 'self' about: blob:; object-src 'none'; base-uri 'self'; form-action 'none'";

async function backendFetch(urlPath, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('X-ChillPass-Desktop-Token', token);
  headers.set('Origin', backendUrl);
  return fetch(`${backendUrl}${urlPath}`, { ...init, headers, redirect: 'error' });
}
async function storageRoot() {
  const response = await backendFetch('/api/getCourseStorageRoot');
  if (!response.ok) throw new Error('Cannot read storage location');
  return (await response.json()).path;
}
async function handleRequest(request) {
  if (!allowedRequest(request.url, request.method)) return json({ error: 'Forbidden' }, 403);
  const origin = request.headers.get('origin');
  if (origin && origin !== 'chillpass://app') return json({ error: 'Forbidden origin' }, 403);
  const url = new URL(request.url);
  try {
    if (url.pathname === '/api/selectDirectory') {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择 ChillPass 学习数据目录', defaultPath: await storageRoot(),
        properties: ['openDirectory', 'createDirectory'],
      });
      return json({ path: result.canceled ? null : result.filePaths[0] });
    }
    if (url.pathname === '/api/openInstallPath') {
      shell.showItemInFolder(process.execPath);
      return json({ ok: true });
    }
    if (url.pathname === '/api/getAppPaths') return json({
      installPath: app.isPackaged ? path.dirname(process.execPath) : app.getAppPath(),
      userDataPath: await storageRoot(), tempPath: app.getPath('temp'),
    });
    if (url.pathname === '/api/openCourseDir') {
      const response = await backendFetch('/api/ensureCourseDir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await request.text(),
      });
      const data = await response.json();
      if (!response.ok) return json(data, response.status);
      const error = await shell.openPath(data.path);
      return error ? json({ error }, 500) : json({ ok: true, path: data.path });
    }
    const headers = new Headers();
    for (const key of ['content-type', 'x-chillpass-data']) {
      if (request.headers.has(key)) headers.set(key, request.headers.get(key));
    }
    const response = await backendFetch(url.pathname + url.search, {
      method: request.method, headers, signal: request.signal,
      ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.arrayBuffer() } : {}),
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('content-length');
    responseHeaders.set('X-Content-Type-Options', 'nosniff');
    if (responseHeaders.get('content-type')?.includes('text/html')) {
      responseHeaders.set('Content-Security-Policy', CSP);
      // Use the desktop policy instead of the old browser-only provider allowlist.
      const html = (await response.text()).replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i, '');
      return new Response(html, { status: response.status, headers: responseHeaders });
    }
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: responseHeaders });
  } catch (error) {
    return json({ error: error.message || 'Local service unavailable' }, 500);
  }
}

function registerIpc() {
  const handle = (channel, action) => ipcMain.handle(channel, (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents
      || event.senderFrame !== mainWindow.webContents.mainFrame || !isAppUrl(event.senderFrame.url)) {
      throw new Error('Untrusted desktop request');
    }
    return action(...args);
  });
  handle('desktop:minimize', () => mainWindow.minimize());
  handle('desktop:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
  handle('desktop:close', () => mainWindow.close());
  handle('desktop:is-maximized', () => mainWindow.isMaximized());
  handle('desktop:fullscreen', enabled => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid fullscreen state');
    mainWindow.setFullScreen(enabled);
  });
  handle('desktop:is-fullscreen', () => mainWindow.isFullScreen());
  handle('desktop:check-updates', () => checkForUpdates(app.getVersion()));
  handle('desktop:open-external', async value => {
    const url = externalUrl(value);
    if (!url) throw new Error('Only HTTP(S) links may be opened externally');
    await shell.openExternal(url);
  });
  handle('desktop:close-result', async (id, error) => {
    if (!closing || id !== closing.id) return;
    clearTimeout(closing.timer);
    closing = null;
    if (error) {
      await dialog.showMessageBox(mainWindow, {
        type: 'warning', title: '尚未保存',
        message: '学习数据尚未保存到硬盘，已取消退出。',
        detail: String(error).slice(0, 1000), buttons: ['返回软件'],
      });
      return;
    }
    session.defaultSession.flushStorageData();
    allowClose = true;
    mainWindow.close();
  });
}
function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'ChillPass', width: 1360, height: 900, minWidth: 900, minHeight: 620,
    show: false, backgroundColor: '#161616', autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'public', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      spellcheck: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const external = externalUrl(url);
    if (external) void shell.openExternal(external).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      const external = externalUrl(url);
      if (external) void shell.openExternal(external).catch(() => {});
    }
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('will-prevent-unload', () => { allowClose = false; });
  mainWindow.on('maximize', () => mainWindow.webContents.send('desktop:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('desktop:maximized', false));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('desktop:focus-exited'));
  mainWindow.on('close', event => {
    if (allowClose) return;
    event.preventDefault();
    if (closing) return;
    const id = randomUUID();
    const timer = setTimeout(() => {
      closing = null;
      if (!mainWindow?.isDestroyed()) void dialog.showMessageBox(mainWindow, {
        type: 'warning', title: '保存确认超时',
        message: '暂未收到保存完成确认，已取消退出。请确认学习数据保存正常后重试。',
      });
    }, 35000);
    closing = { id, timer };
    mainWindow.webContents.send('desktop:prepare-close', id);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.once('ready-to-show', () => {
    if (process.env.CHILLPASS_DESKTOP_TEST !== '1') mainWindow.show();
  });
  return mainWindow.loadURL(APP_URL);
}
async function shutdown() {
  if (quitting) return;
  quitting = true;
  try { if (backend) await backend.close(); } finally { app.quit(); }
}

if (!acquiredLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
  });
  app.on('before-quit', event => {
    if (!quitting && mainWindow) { event.preventDefault(); mainWindow.close(); }
  });
  app.on('window-all-closed', () => { void shutdown(); });
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.chillpass.desktop');
    Menu.setApplicationMenu(null);
    if (!existsSync(path.join(app.getAppPath(), 'dist', 'index.html'))) throw new Error('请先运行 npm run build，或重新安装完整桌面版。');
    process.env.CHILLPASS_APP_DIR = app.getAppPath();
    process.env.CHILLPASS_DESKTOP = '1';
    process.env.CHILLPASS_DESKTOP_TOKEN = token;
    process.env.CHILLPASS_NO_UI = '1';
    backend = require('../installer/app.cjs');
    const address = await backend.ready;
    backendUrl = `http://127.0.0.1:${address.port}`;
    // Copy buttons may write sanitized text; camera, microphone, location and clipboard reads remain denied.
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(permission === 'clipboard-sanitized-write' && isAppUrl(contents.getURL()));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin) =>
      permission === 'clipboard-sanitized-write' && Boolean(contents && isAppUrl(contents.getURL())) && isAppUrl(origin));
    protocol.handle('chillpass', handleRequest);
    registerIpc();
    await createWindow();
  }).catch(async error => {
    console.error('ChillPass desktop startup failed:', error);
    if (process.env.CHILLPASS_DESKTOP_TEST !== '1') dialog.showErrorBox('ChillPass 启动失败', `${error.message}\n学习数据未主动清除。`);
    allowClose = true;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    await shutdown();
  });
}
