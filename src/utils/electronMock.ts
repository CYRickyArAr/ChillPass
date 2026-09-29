/**
 * 浏览器环境下的 Electron API 替代实现
 * 使用 IndexedDB 存储文件，Fullscreen API 实现专注模式
 * 直接 fetch GitHub API 检查更新
 */
import {
  storeFile,
  readFileBuffer,
  readTextFile,
  fileExists,
  getFileSize,
  getStorageSize as getIDBStorageSize,
  ensureCourseDirectory,
  listCourseFiles,
  openCourseDirectory,
  getCourseStorageRoot,
  selectCourseStorageRoot,
} from '@services/browserFileStore'
import { translate, type TranslationKey } from '../i18n'
import { useLanguageStore } from '@stores/languageStore'
import packageJson from '../../package.json'

/** 浏览器 Mock 提示文案（当前语言） */
function mockText(key: TranslationKey, map?: Record<string, string>): string {
  let msg = translate(useLanguageStore.getState().language, key)
  for (const [k, v] of Object.entries(map ?? {})) msg = msg.replace(`{${k}}`, v)
  return msg
}

/** 生成唯一文件 ID */
function generateFileId(): string {
  return 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
}

/** 从 tag 字符串中提取语义化版本号 */
function extractSemver(tag: string): string {
  const match = tag.match(/(\d+\.\d+\.\d+)/)
  return match ? match[1] : '0.0.0'
}

/** 比较语义化版本号 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = extractSemver(v1).split('.').map(Number)
  const parts2 = extractSemver(v2).split('.').map(Number)
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const a = parts1[i] || 0
    const b = parts2[i] || 0
    if (a > b) return 1
    if (a < b) return -1
  }
  return 0
}

const APP_VERSION = packageJson.version
const UPDATE_CHECK_URL =
  'https://api.github.com/repos/CYRickyArAr/ChillPass/contents/package.json?ref=master'
const SOURCE_DOWNLOAD_URL =
  'https://github.com/CYRickyArAr/ChillPass/archive/refs/heads/master.zip'

export function setupElectronMock() {
  if (window.electronAPI) return

  const mockAPI = {
    // ===== 文件对话框 =====
    openFileDialog: async (options?: { courseName?: string }) => {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.accept = '.pdf,.doc,.docx,.ppt,.pptx,.txt,.md'
        input.onchange = async (e) => {
          const files = (e.target as HTMLInputElement).files
          if (!files || files.length === 0) {
            resolve(null)
            return
          }
          // 逐个读取文件并存入 IndexedDB
          const results = []
          for (const file of Array.from(files)) {
            const id = generateFileId()
            const meta = await storeFile(id, file, { courseName: options?.courseName })
            results.push(meta)
          }
          resolve(results)
        }
        input.click()
      })
    },

    openImageDialog: async () => {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = async (e) => {
          const files = (e.target as HTMLInputElement).files
          if (!files || files.length === 0) {
            resolve(null)
            return
          }
          const results = []
          for (const file of Array.from(files)) {
            const id = generateFileId()
            const meta = await storeFile(id, file)
            results.push(meta)
          }
          resolve(results)
        }
        input.click()
      })
    },

    openDirectoryDialog: async () => {
      return await selectCourseStorageRoot()
    },

    ensureCourseDirectory: async (courseName: string) => {
      return await ensureCourseDirectory(courseName)
    },

    listCourseFiles: async (courseName: string) => {
      return await listCourseFiles(courseName)
    },

    openCourseDirectory: async (courseName: string) => {
      await openCourseDirectory(courseName)
    },

    getCourseStorageRoot: async () => {
      return await getCourseStorageRoot()
    },

    // ===== 文件读取（从 IndexedDB） =====
    readFileBuffer: async (filePath: string) => {
      return readFileBuffer(filePath)
    },

    readTextFile: async (filePath: string) => {
      return readTextFile(filePath)
    },

    // ===== 用户数据路径 =====
    getUserDataPath: async () => {
      return await getCourseStorageRoot() ?? mockText('mock.userDataPath')
    },

    // ===== 窗口控制（浏览器中为空操作） =====
    windowMinimize: () => {
      // 浏览器无法最小化窗口
    },
    windowMaximize: () => {
      // 浏览器无法最大化窗口
    },
    windowClose: () => {
      // 浏览器中不关闭窗口，可以提示用户
      if (window.confirm(mockText('mock.closeConfirm'))) {
        window.close()
      }
    },
    windowIsMaximized: async () => false,
    onWindowMaximizeChange: (_callback: (isMaximized: boolean) => void) => {
      return () => {}
    },

    // ===== 专注模式（使用 Fullscreen API） =====
    enterFocusMode: () => {
      document.documentElement.requestFullscreen?.().catch(() => {})
    },
    exitFocusMode: () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {})
      }
    },
    isFullScreen: async () => !!document.fullscreenElement,
    onFocusExited: (callback: () => void) => {
      const handler = () => {
        if (!document.fullscreenElement) callback()
      }
      document.addEventListener('fullscreenchange', handler)
      return () => document.removeEventListener('fullscreenchange', handler)
    },

    // ===== 平台信息 =====
    platform: 'browser',

    // ===== 应用版本 =====
    getAppVersion: async () => APP_VERSION,

    // ===== 应用路径与存储占用 =====
    getAppPaths: async () => {
      // 安装版（SEA）由 app.cjs 提供真实路径；网页预览模式回退到提示信息
      try {
        const res = await fetch('/api/getAppPaths')
        if (res.ok) return await res.json()
      } catch {
        // 忽略，走回退
      }
      return {
        installPath: mockText('mock.installPath'),
        userDataPath: await getCourseStorageRoot() ?? mockText('mock.userDataBrowser'),
        tempPath: mockText('mock.tempPath'),
      }
    },

    // ===== 定位安装位置（安装版在资源管理器中选中 exe） =====
    openInstallPath: async () => {
      try {
        const res = await fetch('/api/openInstallPath', { method: 'POST' })
        if (res.ok) return
      } catch {
        // 忽略，走回退
      }
      window.alert(mockText('mock.installPathAlert'))
    },

    getStorageSize: async () => {
      try {
        return await getIDBStorageSize()
      } catch {
        return 0
      }
    },

    // ===== 源码更新检查：仅提示下载，不安装或覆盖本地文件 =====
    checkForUpdates: async () => {
      // 本地服务优先代理 GitHub 请求，浏览器直连仅作为回退。
      try {
        const res = await fetch('/api/checkForUpdates')
        if (res.ok) {
          const data = await res.json()
          if (!data.updateAvailable) return null
          return {
            version: data.latestVersion,
            releaseNotes: '',
            downloadUrl: SOURCE_DOWNLOAD_URL,
            releaseDate: '',
            currentVersion: data.currentVersion || APP_VERSION,
          }
        }
        throw new Error(`HTTP ${res.status}`)
      } catch {
        // Vite 开发服务没有该端点时，直接读取仓库的 package.json。
        try {
          const response = await fetch(UPDATE_CHECK_URL, {
            headers: { Accept: 'application/vnd.github+json' },
            cache: 'no-store',
            signal: AbortSignal.timeout(12000),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const file = await response.json()
          if (file.encoding !== 'base64' || typeof file.content !== 'string') {
            throw new Error('Invalid package response')
          }
          const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), c => c.charCodeAt(0))
          const latestVersion = JSON.parse(new TextDecoder().decode(bytes)).version
          if (typeof latestVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(latestVersion)) {
            throw new Error('Invalid remote version')
          }

          if (compareVersions(latestVersion, APP_VERSION) > 0) {
            return {
              version: latestVersion,
              releaseNotes: '',
              downloadUrl: SOURCE_DOWNLOAD_URL,
              releaseDate: '',
              currentVersion: APP_VERSION,
            }
          }
          return null
        } catch (err) {
          throw new Error(
            mockText('mock.updateServerUnreachable', {
              msg: err instanceof Error ? err.message : mockText('common.unknownError'),
            }),
          )
        }
      }
    },

    // ===== 自动更新：下载安装包并启动更新程序 =====
    startUpdate: async () => {
      const res = await fetch('/api/startUpdate', { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },

    openExternalUrl: async (url: string) => {
      window.open(url, '_blank')
    },

    // ===== 资源迁移（浏览器中为空操作） =====
    migrateFiles: async (_filePaths: string[], _targetDir: string, _move?: boolean) => {
      throw new Error('请使用课件存储页面的浏览器文件迁移入口；切换目录只影响新文件，旧文件会保留。')
    },

    getFileSize: async (filePath: string) => {
      try {
        return await getFileSize(filePath)
      } catch {
        return 0
      }
    },

    fileExists: async (filePath: string) => {
      try {
        return await fileExists(filePath)
      } catch {
        return false
      }
    },
  }

  Object.defineProperty(window, 'electronAPI', {
    value: mockAPI,
    writable: false,
    configurable: true,
  })
}
