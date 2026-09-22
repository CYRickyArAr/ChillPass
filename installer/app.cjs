/**
 * ChillPass Web - SEA (Single Executable Application) Entry Point
 *
 * CommonJS version — Node.js SEA requires CJS for reliable embedding.
 * Starts the local HTTP server, opens the browser, and launches the
 * system tray script.
 *
 * Only uses Node.js built-in modules — no npm dependencies.
 */
'use strict';

const { createServer } = require('node:http');
const { readFile, stat, mkdir, writeFile, readdir, access } = require('node:fs/promises');
const { existsSync, readFileSync, constants } = require('node:fs');
const { extname, join, normalize, dirname, resolve, relative, basename, isAbsolute } = require('node:path');
const { exec, spawn } = require('node:child_process');
const os = require('node:os');
const https = require('node:https');
const { createDataStorage, migrateRoot } = require('./data-storage.cjs');
const handleLearningData = createDataStorage(() => courseStorageRoot);

// ── Safe console (GUI subsystem has no valid stdout) ───────────
const originalLog = console.log.bind(console), originalError = console.error.bind(console);
const safeLog = (...args) => { try { originalLog(...args) } catch {} };
const safeError = (...args) => { try { originalError(...args) } catch {} };
console.log = safeLog;
console.error = safeError;

// ── Resolve base directory ──────────────────────────────────────
// In SEA (CJS): __dirname → directory of the executable
// In dev:       __dirname → directory of this script
// This is where dist/, tray.ps1, and icon.ico live.
const BASE_DIR = process.env.CHILLPASS_APP_DIR || __dirname;
const DIST_DIR = join(BASE_DIR, 'dist');
const TRAY_SCRIPT = join(BASE_DIR, 'tray.ps1');
const ICON_PATH = join(BASE_DIR, 'icon.ico');
const PORT = Number(process.env.CHILLPASS_PORT) || 5174;
const APP_VERSION = '0.1.1';
const BUILD_ID = '20260922-local-learning-data';
const GITHUB_REPO = 'CYRickyArAr/ChillPass';
const DEFAULT_COURSE_STORAGE_ROOT = join(os.homedir(), 'Documents', 'ChillPass');
const USER_CONFIG_DIR = process.env.CHILLPASS_CONFIG_DIR || join(os.homedir(), '.chillpass');
const USER_CONFIG_PATH = join(USER_CONFIG_DIR, 'config.json');
let previousStorageRoots = [];
function loadCourseStorageRoot() {
  try {
    if (!existsSync(USER_CONFIG_PATH)) return DEFAULT_COURSE_STORAGE_ROOT;
    const config = JSON.parse(readFileSync(USER_CONFIG_PATH, 'utf8'));
    previousStorageRoots = Array.isArray(config.previousStorageRoots)
      ? config.previousStorageRoots.filter(p => typeof p === 'string' && isAbsolute(p)) : [];
    return typeof config.courseStorageRoot === 'string' && config.courseStorageRoot.trim()
      ? resolve(config.courseStorageRoot)
      : DEFAULT_COURSE_STORAGE_ROOT;
  } catch {
    return DEFAULT_COURSE_STORAGE_ROOT;
  }
}
let courseStorageRoot = loadCourseStorageRoot();
const COURSE_FILE_EXTS = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.md']);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
};

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function sanitizeCourseName(name) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || '未命名课程';
}

function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !/^[a-zA-Z]:/.test(rel));
}

async function ensureStorageRoot() {
  await mkdir(courseStorageRoot, { recursive: true });
  return courseStorageRoot;
}

async function saveStorageRoot(nextRoot, previousRoots) {
  await mkdir(USER_CONFIG_DIR, { recursive: true });
  await writeFile(USER_CONFIG_PATH, JSON.stringify({ courseStorageRoot: nextRoot, previousStorageRoots: previousRoots }, null, 2), 'utf8');
}

async function setStorageRoot(rawPath) {
  const nextRoot = String(rawPath || '').trim()
    ? resolve(String(rawPath))
    : DEFAULT_COURSE_STORAGE_ROOT;
  await mkdir(nextRoot, { recursive: true });
  await access(nextRoot, constants.W_OK);
  const previousRoots = Array.from(new Set([...previousStorageRoots, courseStorageRoot]));
  await migrateRoot(courseStorageRoot, nextRoot, async () => {
    await saveStorageRoot(nextRoot, previousRoots);
    previousStorageRoots = previousRoots;
    courseStorageRoot = nextRoot;
  });
  return courseStorageRoot;
}

async function ensureCourseDir(courseName) {
  const root = await ensureStorageRoot();
  const safeName = sanitizeCourseName(courseName);
  const dir = join(root, safeName);
  if (!isInside(root, dir)) throw new Error('Invalid course directory');
  await mkdir(dir, { recursive: true });
  return { courseName: safeName, path: dir };
}

function readRequestBuffer(req, limit = 300 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('File too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readRequestJson(req) {
  const buffer = await readRequestBuffer(req, 1024 * 1024);
  if (!buffer.length) return {};
  return JSON.parse(buffer.toString('utf8'));
}

async function uniqueTargetPath(dir, fileName, size) {
  const original = basename(String(fileName || 'courseware'));
  const ext = extname(original);
  const stem = original.slice(0, original.length - ext.length) || 'courseware';
  let target = join(dir, original);
  if (!isInside(dir, target)) target = join(dir, `courseware${ext}`);
  for (let i = 0; i < 1000; i++) {
    try {
      const s = await stat(target);
      // Never overwrite a previously imported file, even when its size matches.
    } catch {
      return target;
    }
    target = join(dir, `${stem} (${i + 1})${ext}`);
  }
  throw new Error('Too many duplicate file names');
}

async function listCourseFiles(courseName) {
  const { path: dir } = await ensureCourseDir(courseName);
  const out = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (!isInside(dir, fullPath)) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      if (!COURSE_FILE_EXTS.has(ext)) continue;
      const s = await stat(fullPath);
      out.push({ path: fullPath, name: entry.name, ext, size: s.size });
    }
  }
  await walk(dir);
  return out;
}

function safeCourseFilePath(filePath) {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) return null;
  const target = resolve(String(filePath || ''));
  const allowedRoots = Array.from(new Set([courseStorageRoot, DEFAULT_COURSE_STORAGE_ROOT, ...previousStorageRoots]));
  return allowedRoots.some((root) => isInside(root, target)) ? target : null;
}

function selectDirectoryDialog() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ChillPassWindowTools {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
"@
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择 ChillPass 资源存储位置'
$dialog.ShowNewFolderButton = $true
try { $dialog.AutoUpgradeEnabled = $true } catch {}
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.Add_Tick({
  $hwnd = [ChillPassWindowTools]::FindWindow('#32770', '浏览文件夹')
  if ($hwnd -eq [IntPtr]::Zero) { $hwnd = [ChillPassWindowTools]::FindWindow('#32770', 'Browse For Folder') }
  if ($hwnd -eq [IntPtr]::Zero) { $hwnd = [ChillPassWindowTools]::FindWindow('#32770', $null) }
  if ($hwnd -ne [IntPtr]::Zero) {
    $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $w = [Math]::Min(900, $area.Width - 80)
    $h = [Math]::Min(640, $area.Height - 80)
    $x = $area.Left + [Math]::Max(0, [int](($area.Width - $w) / 2))
    $y = $area.Top + [Math]::Max(0, [int](($area.Height - $h) / 2))
    [ChillPassWindowTools]::MoveWindow($hwnd, $x, $y, $w, $h, $true) | Out-Null
    $timer.Stop()
  }
})
$timer.Start()
try { $result = $dialog.ShowDialog() } finally { $timer.Stop(); $timer.Dispose() }
if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }
`;
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolvePath) => {
    exec(`powershell.exe -NoProfile -STA -EncodedCommand ${encodedScript}`, (error, stdout) => {
      if (error) {
        resolvePath(null);
        return;
      }
      resolvePath(stdout.trim() || null);
    });
  });
}

// ── Launch system tray ──────────────────────────────────────────
let trayProcess = null;

function launchTray() {
  if (process.platform !== 'win32') return;
  if (!existsSync(TRAY_SCRIPT)) {
    console.log('[Tray] tray.ps1 not found, skipping tray icon.');
    return;
  }

  const psArgs = [
    '-ExecutionPolicy', 'Bypass',
    '-NoProfile',
    '-WindowStyle', 'Hidden',
    '-File', TRAY_SCRIPT,
    '-ParentPid', String(process.pid),
    '-Url', `http://localhost:${PORT}`,
    '-Icon', ICON_PATH,
  ];

  trayProcess = spawn('powershell.exe', psArgs, {
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });

  trayProcess.on('error', (err) => {
    console.log(`[Tray] Failed to launch: ${err.message}`);
  });

  trayProcess.unref();
}

// ── Graceful shutdown ───────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down...`);
  if (trayProcess && !trayProcess.killed) {
    try { trayProcess.kill(); } catch (e) {}
  }
  server.close(() => process.exit(0));
  // Force exit after 3s if server.close hangs
  setTimeout(() => process.exit(0), 3000);
}

// ── Version compare ─────────────────────────────────────────────
function compareVersion(a, b) {
  const pa = String(a || '0.0.0').replace(/^v/, '').split('.').map(Number);
  const pb = String(b || '0.0.0').replace(/^v/, '').split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const av = pa[i] || 0, bv = pb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

// ── GitHub HTTPS request (with proxy fallback) ─────────────────
function httpsGetJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'ChillPass-Updater/1.0',
        Accept: 'application/vnd.github+json',
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => {
        data += c;
        if (data.length > 5 * 1024 * 1024) { req.destroy(); reject(new Error('Response too large')); }
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        } else { reject(new Error(`HTTP ${res.statusCode}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout')));
  });
}

async function fetchLatestRelease() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const urls = [
    apiUrl,
    `https://gh-proxy.com/${apiUrl}`,
  ];
  for (const url of urls) {
    try { return await httpsGetJson(url); } catch { /* try next */ }
  }
  return null;
}

function normalizeProviderModelsUrl(rawUrl) {
  const url = new URL(String(rawUrl || ''));
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP(S) provider URLs are supported');
  }
  return url.toString();
}

async function fetchProviderModelsThroughServer(rawUrl, apiKey) {
  const url = normalizeProviderModelsUrl(rawUrl);
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Missing API Key');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
        'User-Agent': 'ChillPass/0.1.1',
      },
      signal: controller.signal,
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      return {
        ok: false,
        status: upstream.status,
        error: text.slice(0, 500) || upstream.statusText,
      };
    }
    try {
      return { ok: true, status: upstream.status, data: text ? JSON.parse(text) : {} };
    } catch {
      return { ok: false, status: upstream.status, error: text.slice(0, 500) || 'Invalid JSON response' };
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── API endpoints ──────────────────────────────────────────────
function sendJson(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function handleApi(req, res, urlPath) {
  if (await handleLearningData(req, res, urlPath)) return true;
  const requestUrl = new URL(req.url, `http://localhost:${PORT}`);
  if (urlPath === '/api/fetchProviderModels' && req.method === 'POST') {
    try {
      const body = await readRequestJson(req);
      const result = await fetchProviderModelsThroughServer(body.url, body.apiKey);
      if (!result.ok) {
        sendJson(res, { error: result.error }, result.status || 502);
        return true;
      }
      sendJson(res, result.data);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : 'Provider model fetch failed' }, 502);
    }
    return true;
  }
  // 获取应用版本
  if (urlPath === '/api/getAppVersion' && req.method === 'GET') {
    sendJson(res, { version: APP_VERSION, buildId: BUILD_ID });
    return true;
  }
  if (urlPath === '/api/getCourseStorageRoot' && req.method === 'GET') {
    sendJson(res, { path: await ensureStorageRoot() });
    return true;
  }
  if (urlPath === '/api/setCourseStorageRoot' && req.method === 'POST') {
    const body = await readRequestJson(req);
    sendJson(res, { path: await setStorageRoot(body.path || '') });
    return true;
  }
  if (urlPath === '/api/selectDirectory' && req.method === 'POST') {
    sendJson(res, { path: await selectDirectoryDialog() });
    return true;
  }
  if (urlPath === '/api/ensureCourseDir' && req.method === 'POST') {
    const body = await readRequestJson(req);
    sendJson(res, await ensureCourseDir(body.courseName));
    return true;
  }
  if (urlPath === '/api/listCourseFiles' && req.method === 'GET') {
    sendJson(res, await listCourseFiles(requestUrl.searchParams.get('courseName') || ''));
    return true;
  }
  if (urlPath === '/api/storeCourseFile' && req.method === 'POST') {
    const courseName = requestUrl.searchParams.get('courseName') || '';
    const fileName = requestUrl.searchParams.get('fileName') || 'courseware';
    const buffer = await readRequestBuffer(req);
    if (/\.pdf$/i.test(fileName) && !buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
      sendJson(res, { error: '上传内容不是有效的 PDF 文件，请重新选择原文件。' }, 422);
      return true;
    }
    const { path: dir } = await ensureCourseDir(courseName);
    const target = await uniqueTargetPath(dir, fileName, buffer.length);
    await writeFile(target, buffer, { flag: 'wx' });
    sendJson(res, { path: target, name: basename(target), ext: extname(target).toLowerCase(), size: buffer.length });
    return true;
  }
  if (urlPath === '/api/openCourseDir' && req.method === 'POST') {
    const body = await readRequestJson(req);
    const { path: dir } = await ensureCourseDir(body.courseName);
    exec(`explorer.exe "${dir}"`, (err) => {
      if (err) safeLog(`[OpenCourseDir] ${err.message}`);
    });
    sendJson(res, { ok: true, path: dir });
    return true;
  }
  if (urlPath === '/api/readFile' && req.method === 'GET') {
    const target = safeCourseFilePath(requestUrl.searchParams.get('path') || '');
    if (!target) {
      sendJson(res, { error: 'Invalid path' }, 403);
      return true;
    }
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-store' });
    res.end(data);
    return true;
  }
  if (urlPath === '/api/fileExists' && req.method === 'GET') {
    const target = safeCourseFilePath(requestUrl.searchParams.get('path') || '');
    if (!target) {
      sendJson(res, { exists: false });
      return true;
    }
    sendJson(res, { exists: existsSync(target) });
    return true;
  }
  if (urlPath === '/api/getFileSize' && req.method === 'GET') {
    const target = safeCourseFilePath(requestUrl.searchParams.get('path') || '');
    if (!target || !existsSync(target)) {
      sendJson(res, { size: 0 });
      return true;
    }
    const s = await stat(target);
    sendJson(res, { size: s.isFile() ? s.size : 0 });
    return true;
  }
  // 获取应用路径信息
  if (urlPath === '/api/getAppPaths' && req.method === 'GET') {
    sendJson(res, {
      installPath: BASE_DIR,
      exePath: process.execPath,
      userDataPath: await ensureStorageRoot(),
      tempPath: os.tmpdir(),
    });
    return true;
  }
  // 在资源管理器中定位安装位置（选中 exe）
  if (urlPath === '/api/openInstallPath' && req.method === 'POST') {
    const exe = process.execPath;
    exec(`explorer.exe /select,"${exe}"`, (err) => {
      if (err) safeLog(`[OpenPath] ${err.message}`);
    });
    sendJson(res, { ok: true });
    return true;
  }
  // 检查更新（后端请求 GitHub，避免浏览器跨域/网络限制）
  if (urlPath === '/api/checkForUpdates' && req.method === 'GET') {
    const release = await fetchLatestRelease();
    if (!release) {
      sendJson(res, { error: '无法获取版本信息，请检查网络连接后重试' }, 502);
      return true;
    }
    const latestVersion = String(release.tag_name || '0.0.0').replace(/^v/, '');
    const asset = (release.assets || []).find(
      (a) => /\.exe$/i.test(a.name) && !/\.blockmap$/i.test(a.name),
    );
    const hasUpdate = compareVersion(latestVersion, APP_VERSION) > 0;
    sendJson(res, {
      updateAvailable: hasUpdate,
      latestVersion,
      currentVersion: APP_VERSION,
      downloadUrl: asset ? asset.browser_download_url : (release.html_url || ''),
      releaseNotes: release.body || '',
      releaseDate: release.published_at || '',
    });
    return true;
  }
  // 自动更新：启动 updater.ps1 -Silent（下载安装包 → 静默安装 → 重启）
  if (urlPath === '/api/startUpdate' && req.method === 'POST') {
    const updater = join(BASE_DIR, 'updater.ps1');
    if (!existsSync(updater)) {
      sendJson(res, { error: '未找到更新程序（updater.ps1）' }, 500);
      return true;
    }
    const psArgs = [
      '-ExecutionPolicy', 'Bypass',
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-File', updater,
      '-Silent',
    ];
    const child = spawn('powershell.exe', psArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', (err) => safeLog(`[StartUpdate] ${err.message}`));
    child.unref();
    sendJson(res, { ok: true });
    return true;
  }
  return false;
}

// ── HTTP server ─────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url ? req.url.split('?')[0] : '/');

    // API routes take priority
    if (urlPath.startsWith('/api/')) {
      if (await handleApi(req, res, urlPath)) return;
      sendJson(res, { error: 'Not Found' }, 404);
      return;
    }

    // Security: prevent path traversal
    const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(DIST_DIR, safePath);

    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      // SPA fallback: serve index.html for unknown routes
      filePath = join(DIST_DIR, 'index.html');
      stats = await stat(filePath);
    }

    if (stats.isDirectory()) {
      filePath = join(filePath, 'index.html');
      stats = await stat(filePath);
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const data = await readFile(filePath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(data);
  } catch (error) {
    // Final fallback
    if (req.url?.split('?')[0].startsWith('/api/')) {
      const code = error?.code || 'STORAGE_ERROR';
      const status = code === 'ENOENT' ? 404 : ['EACCES', 'EPERM'].includes(code) ? 403 : 500;
      sendJson(res, { error: `文件操作失败 (${code})：${error?.message || '未知错误'}`, code }, status);
      return;
    }
    try {
      const fallback = await readFile(join(DIST_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fallback);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 - 文件未找到。请先运行构建。');
    }
  }
});

// ── Start ───────────────────────────────────────────────────────
server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\n  端口 ${PORT} 已被占用，可能已有实例在运行。`);
    let sameBuild = false;
    try {
      const response = await fetch(`http://localhost:${PORT}/api/getAppVersion`, { signal: AbortSignal.timeout(2000) });
      sameBuild = (await response.json()).buildId === BUILD_ID;
    } catch {}
    if (sameBuild) openBrowser(`http://localhost:${PORT}`);
    else exec('powershell.exe -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(\'端口 5174 正在被旧版 ChillPass 或开发服务使用。请先从托盘退出旧程序，或停止开发服务，然后重新启动。\', \'ChillPass\')"');
    setTimeout(() => process.exit(0), 1500);
  } else {
    console.error(`服务器错误: ${err.message}`);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  ============================================');
  console.log('                                             ');
  console.log('   ChillPass 期末冲刺助手 已启动             ');
  console.log(`   版本: ${APP_VERSION}                      `);
  console.log('                                             ');
  console.log(`   访问地址: ${url}          `);
  console.log('                                             ');
  console.log('   浏览器将自动打开，如未打开请手动访问       ');
  console.log('                                             ');
  console.log('   按 Ctrl+C 停止服务器                      ');
  console.log('                                             ');
  console.log('  ============================================');
  console.log('');

  // Launch system tray
  if (process.env.CHILLPASS_NO_UI !== '1') launchTray();

  // Auto-open browser after 500ms
  if (process.env.CHILLPASS_NO_UI !== '1') setTimeout(() => openBrowser(url), 500);
});

// Handle termination signals
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
