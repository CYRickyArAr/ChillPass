import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import { exec } from 'node:child_process'
import { createRequire } from 'node:module'
const APP_VERSION: string = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version
const { createDataStorage, migrateRoot } = createRequire(import.meta.url)('./installer/data-storage.cjs')
const handleLearningData = createDataStorage(() => courseStorageRoot)

const DEFAULT_COURSE_STORAGE_ROOT = path.join(os.homedir(), 'Documents', 'ChillPass')
const CONFIG_DIR = path.join(os.homedir(), '.chillpass')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')
let courseStorageRoot = DEFAULT_COURSE_STORAGE_ROOT
let previousStorageRoots: string[] = []
try {
  const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  if (typeof saved.courseStorageRoot === 'string' && path.isAbsolute(saved.courseStorageRoot)) courseStorageRoot = saved.courseStorageRoot
  previousStorageRoots = Array.isArray(saved.previousStorageRoots) ? saved.previousStorageRoots.filter((p: unknown) => typeof p === 'string' && path.isAbsolute(p)) : []
} catch {}
const COURSE_FILE_EXTS = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.md'])

function sanitizeCourseName(name: string) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim() || '未命名课程'
}

function isInside(parent: string, child: string) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

async function ensureStorageRoot() {
  await fsp.mkdir(courseStorageRoot, { recursive: true })
  return courseStorageRoot
}

async function setStorageRoot(rawPath: string) {
  const nextRoot = String(rawPath || '').trim()
    ? path.resolve(String(rawPath))
    : DEFAULT_COURSE_STORAGE_ROOT
  await fsp.mkdir(nextRoot, { recursive: true })
  await fsp.access(nextRoot, fs.constants.W_OK)
  const previousRoots = Array.from(new Set([...previousStorageRoots, courseStorageRoot]))
  await fsp.mkdir(CONFIG_DIR, { recursive: true })
  await migrateRoot(courseStorageRoot, nextRoot, async () => {
    await fsp.writeFile(CONFIG_PATH, JSON.stringify({ courseStorageRoot: nextRoot, previousStorageRoots: previousRoots }, null, 2), 'utf8')
    previousStorageRoots = previousRoots
    courseStorageRoot = nextRoot
  })
  return courseStorageRoot
}

async function ensureCourseDir(courseName: string) {
  const root = await ensureStorageRoot()
  const safeName = sanitizeCourseName(courseName)
  const dir = path.join(root, safeName)
  if (!isInside(root, dir)) throw new Error('Invalid course directory')
  await fsp.mkdir(dir, { recursive: true })
  return { courseName: safeName, path: dir }
}

function sendJson(res: any, obj: unknown, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

function readRequestBuffer(req: any, limit = 300 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('File too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readRequestJson(req: any) {
  const buffer = await readRequestBuffer(req, 1024 * 1024)
  return buffer.length ? JSON.parse(buffer.toString('utf8')) : {}
}

async function uniqueTargetPath(dir: string, fileName: string, size: number) {
  const original = path.basename(String(fileName || 'courseware'))
  const ext = path.extname(original)
  const stem = original.slice(0, original.length - ext.length) || 'courseware'
  let target = path.join(dir, original)
  if (!isInside(dir, target)) target = path.join(dir, `courseware${ext}`)
  for (let i = 0; i < 1000; i++) {
    try {
      const s = await fsp.stat(target)
      // Preserve existing imports; always choose an unused path.
    } catch {
      return target
    }
    target = path.join(dir, `${stem} (${i + 1})${ext}`)
  }
  throw new Error('Too many duplicate file names')
}

async function listCourseFiles(courseName: string) {
  const { path: dir } = await ensureCourseDir(courseName)
  const out: Array<{ path: string; name: string; ext: string; size: number }> = []
  async function walk(current: string) {
    const entries = await fsp.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (!isInside(dir, fullPath)) continue
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!COURSE_FILE_EXTS.has(ext)) continue
      const s = await fsp.stat(fullPath)
      out.push({ path: fullPath, name: entry.name, ext, size: s.size })
    }
  }
  await walk(dir)
  return out
}

function safeCourseFilePath(filePath: string) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return null
  const target = path.resolve(String(filePath || ''))
  const allowedRoots = Array.from(new Set([courseStorageRoot, DEFAULT_COURSE_STORAGE_ROOT, ...previousStorageRoots]))
  return allowedRoots.some(root => isInside(root, target)) ? target : null
}

function selectDirectoryDialog(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
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
`
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise(resolve => {
    exec(`powershell.exe -NoProfile -STA -EncodedCommand ${encodedScript}`, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      resolve(stdout.trim() || null)
    })
  })
}

function normalizeProviderModelsUrl(rawUrl: string) {
  const url = new URL(String(rawUrl || ''))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) provider URLs are supported')
  return url.toString()
}

async function fetchProviderModelsThroughServer(rawUrl: string, apiKey: string) {
  const url = normalizeProviderModelsUrl(rawUrl)
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('Missing API Key')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const upstream = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
        'User-Agent': `ChillPass/${APP_VERSION}`,
      },
      signal: controller.signal,
    })
    const text = await upstream.text()
    if (!upstream.ok) {
      return {
        ok: false,
        status: upstream.status,
        error: text.slice(0, 500) || upstream.statusText,
      }
    }
    try {
      return { ok: true, status: upstream.status, data: text ? JSON.parse(text) : {} }
    } catch {
      return { ok: false, status: upstream.status, error: text.slice(0, 500) || 'Invalid JSON response' }
    }
  } finally {
    clearTimeout(timeout)
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'chillpass-course-storage-api',
      configureServer(server) {
        server.middlewares.use(async (req: any, res: any, next: any) => {
          try {
            const requestUrl = new URL(req.url || '/', 'http://localhost')
            const urlPath = requestUrl.pathname
            if (!urlPath.startsWith('/api/')) return next()
            if (await handleLearningData(req, res, urlPath)) return
            if (urlPath === '/api/getAppVersion') return sendJson(res, { version: APP_VERSION, buildId: 'development-local-learning-data' })

            if (urlPath === '/api/fetchProviderModels' && req.method === 'POST') {
              const body = await readRequestJson(req)
              const result = await fetchProviderModelsThroughServer(body.url, body.apiKey)
              if (!result.ok) return sendJson(res, { error: result.error }, result.status || 502)
              sendJson(res, result.data)
              return
            }
            if (urlPath === '/api/getCourseStorageRoot' && req.method === 'GET') {
              sendJson(res, { path: await ensureStorageRoot() })
              return
            }
            if (urlPath === '/api/setCourseStorageRoot' && req.method === 'POST') {
              const body = await readRequestJson(req)
              sendJson(res, { path: await setStorageRoot(body.path || '') })
              return
            }
            if (urlPath === '/api/selectDirectory' && req.method === 'POST') {
              sendJson(res, { path: await selectDirectoryDialog() })
              return
            }
            if (urlPath === '/api/ensureCourseDir' && req.method === 'POST') {
              sendJson(res, await ensureCourseDir((await readRequestJson(req)).courseName))
              return
            }
            if (urlPath === '/api/listCourseFiles' && req.method === 'GET') {
              sendJson(res, await listCourseFiles(requestUrl.searchParams.get('courseName') || ''))
              return
            }
            if (urlPath === '/api/storeCourseFile' && req.method === 'POST') {
              const buffer = await readRequestBuffer(req)
              const fileName = requestUrl.searchParams.get('fileName') || 'courseware'
              if (/\.pdf$/i.test(fileName) && !buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
                return sendJson(res, { error: '上传内容不是有效的 PDF 文件，请重新选择原文件。' }, 422)
              }
              const { path: dir } = await ensureCourseDir(requestUrl.searchParams.get('courseName') || '')
              const target = await uniqueTargetPath(dir, requestUrl.searchParams.get('fileName') || 'courseware', buffer.length)
              await fsp.writeFile(target, buffer, { flag: 'wx' })
              sendJson(res, { path: target, name: path.basename(target), ext: path.extname(target).toLowerCase(), size: buffer.length })
              return
            }
            if (urlPath === '/api/openCourseDir' && req.method === 'POST') {
              const { path: dir } = await ensureCourseDir((await readRequestJson(req)).courseName)
              exec(`explorer.exe "${dir}"`, () => {})
              sendJson(res, { ok: true, path: dir })
              return
            }
            if (urlPath === '/api/readFile' && req.method === 'GET') {
              const target = safeCourseFilePath(requestUrl.searchParams.get('path') || '')
              if (!target) return sendJson(res, { error: 'Invalid path' }, 403)
              res.setHeader('Content-Type', 'application/octet-stream')
              res.setHeader('Cache-Control', 'no-store')
              res.end(await fsp.readFile(target))
              return
            }
            if (urlPath === '/api/fileExists' && req.method === 'GET') {
              const target = safeCourseFilePath(requestUrl.searchParams.get('path') || '')
              sendJson(res, { exists: Boolean(target && fs.existsSync(target)) })
              return
            }
            if (urlPath === '/api/getFileSize' && req.method === 'GET') {
              const target = safeCourseFilePath(requestUrl.searchParams.get('path') || '')
              if (!target || !fs.existsSync(target)) return sendJson(res, { size: 0 })
              const s = await fsp.stat(target)
              sendJson(res, { size: s.isFile() ? s.size : 0 })
              return
            }
            sendJson(res, { error: 'Not Found' }, 404)
          } catch (error) {
            sendJson(res, { error: error instanceof Error ? error.message : 'Storage API failed' }, 500)
          }
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@stores': path.resolve(__dirname, 'src/stores'),
      '@i18n': path.resolve(__dirname, 'src/i18n/index'),
      '@services': path.resolve(__dirname, 'src/services'),
      '@types': path.resolve(__dirname, 'src/types'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@styles': path.resolve(__dirname, 'src/styles')
    }
  },
  base: './',
  server: {
    watch: {
      // Windows 环境下默认文件监听可能漏事件，导致 HMR/刷新拿到过期模块，改用轮询
      usePolling: true,
      interval: 300
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
