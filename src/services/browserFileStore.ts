/**
 * 浏览器文件存储服务
 * 使用 IndexedDB 持久化用户上传的课件文件内容
 * 替代 Electron 的文件系统访问能力
 */
import { translate } from '../i18n'
import { useLanguageStore } from '@stores/languageStore'

import { changeLearningDataRoot } from './learningDataStorage'

const DB_NAME = 'chillpass-files'
const DB_VERSION = 1
const STORE_NAME = 'files'

/** 文件元数据 + 内容 */
interface StoredFile {
  id: string
  name: string
  ext: string
  size: number
  buffer: ArrayBuffer
  uploadedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

interface StoreFileOptions {
  courseName?: string
}

/** Old records remain compatible: browser IDs are never sent to filesystem APIs. */
export function isDiskFilePath(value: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(value)
}

export function validateFileBuffer(name: string, buffer: ArrayBuffer, expectedSize?: number): void {
  if (expectedSize !== undefined && buffer.byteLength !== expectedSize) {
    throw new Error(`课件大小不一致，请重新选择原文件：${name}`)
  }
  if (/\.pdf$/i.test(name)) {
    const header = new TextDecoder('latin1').decode(buffer.slice(0, 1024))
    if (!header.includes('%PDF-')) throw new Error(`读取到的内容不是 PDF，请重新选择原文件：${name}`)
  }
}

async function responseJson<T>(res: Response): Promise<T> {
  if (!res.headers.get('content-type')?.includes('application/json')) {
    throw new Error('本地服务返回了网页而不是文件数据，请退出旧程序并重新启动最新版。')
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `文件服务错误 (${res.status})`)
  return data as T
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init)
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

async function storeFileInCourseFolder(
  courseName: string,
  file: File,
): Promise<{ path: string; name: string; ext: string; size: number } | null> {
  return storeBufferInCourseFolder(courseName, file.name, await file.arrayBuffer())
}

export async function storeBufferInCourseFolder(
  courseName: string,
  fileName: string,
  buffer: ArrayBuffer,
): Promise<{ path: string; name: string; ext: string; size: number } | null> {
  const trimmedCourseName = courseName.trim()
  if (!trimmedCourseName) return null
  validateFileBuffer(fileName, buffer)
  try {
    const params = new URLSearchParams({
      courseName: trimmedCourseName,
      fileName,
    })
    const res = await fetch(`/api/storeCourseFile?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
    })
    const stored = await responseJson<{ path: string; name: string; ext: string; size: number }>(res)
    if (!isDiskFilePath(stored.path) || stored.size !== buffer.byteLength) throw new Error('文件保存结果不完整')
    const saved = await readLocalFileBuffer(stored.path)
    const [before, after] = await Promise.all([
      crypto.subtle.digest('SHA-256', buffer), crypto.subtle.digest('SHA-256', saved),
    ])
    if (!new Uint8Array(before).every((byte, i) => byte === new Uint8Array(after)[i])) throw new Error('文件保存校验失败')
    return stored
  } catch {
    return null
  }
}

async function readLocalFileBuffer(filePath: string): Promise<ArrayBuffer> {
    const params = new URLSearchParams({ path: filePath })
    const res = await fetch(`/api/readFile?${params.toString()}`)
    if (!res.ok) { await responseJson(res); throw new Error(`读取文件失败 (${res.status})`) }
    if (res.headers.get('content-type')?.split(';')[0] !== 'application/octet-stream') {
      throw new Error('文件服务返回了非文件内容，请退出旧程序并重新启动最新版。')
    }
    const buffer = await res.arrayBuffer()
    validateFileBuffer(filePath, buffer)
    return buffer
}

/** IndexedDB 不接受空键；将底层异常转换为可操作的提示。 */
function requireFileId(id: string): string {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(translate(useLanguageStore.getState().language, 'service.fileKeyMissing'))
  }
  return id
}

/** 打开/创建 IndexedDB 数据库 */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
  })

  return dbPromise
}

/**
 * 存储文件到 IndexedDB
 * @param id 文件唯一 ID（作为路径使用）
 * @param file File 对象
 * @returns 文件元数据
 */
export async function storeFile(
  id: string,
  file: File,
  options?: StoreFileOptions,
): Promise<{ path: string; name: string; ext: string; size: number }> {
  if (options?.courseName) {
    const stored = await storeFileInCourseFolder(options.courseName, file)
    if (stored) return stored
  }

  const fileId = requireFileId(id)
  const buffer = await file.arrayBuffer()
  validateFileBuffer(file.name, buffer, file.size)
  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase()

  const stored: StoredFile = {
    id: fileId,
    name: file.name,
    ext,
    size: file.size,
    buffer,
    uploadedAt: Date.now(),
  }

  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(stored)
    tx.oncomplete = () =>
      resolve({ path: fileId, name: file.name, ext, size: file.size })
    request.onerror = () => reject(request.error)
    tx.onabort = () => reject(tx.error || new Error('浏览器文件保存失败'))
  })
}

/**
 * 从 IndexedDB 读取文件 ArrayBuffer
 * @param id 文件 ID（即应用中的 path）
 */
export async function readFileBuffer(id: string): Promise<ArrayBuffer> {
  const fileId = requireFileId(id)
  if (isDiskFilePath(fileId)) return readLocalFileBuffer(fileId)

  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(fileId)
    request.onsuccess = () => {
      const result = request.result as StoredFile | undefined
      if (result) {
        try { validateFileBuffer(result.name, result.buffer, result.size); resolve(result.buffer) }
        catch (error) { reject(error) }
      } else {
        reject(new Error(translate(useLanguageStore.getState().language, 'service.fileNotFound').replace('{id}', fileId)))
      }
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * 从 IndexedDB 读取文件并解码为文本
 * @param id 文件 ID（即应用中的 path）
 */
export async function readTextFile(id: string): Promise<string> {
  const buffer = await readFileBuffer(id)
  return new TextDecoder('utf-8').decode(buffer)
}

/**
 * 检查文件是否存在
 * @param id 文件 ID
 */
export async function fileExists(id: string): Promise<boolean> {
  const fileId = requireFileId(id)
  if (isDiskFilePath(fileId)) {
    const local = await fetchJson<{ exists: boolean }>(
    `/api/fileExists?${new URLSearchParams({ path: fileId }).toString()}`,
  )
    return local?.exists === true
  }

  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.count(fileId)
    request.onsuccess = () => resolve(request.result > 0)
    request.onerror = () => reject(request.error)
  })
}

/**
 * 获取文件大小
 * @param id 文件 ID
 */
export async function getFileSize(id: string): Promise<number> {
  const fileId = requireFileId(id)
  if (isDiskFilePath(fileId)) {
    const local = await fetchJson<{ size: number }>(
    `/api/getFileSize?${new URLSearchParams({ path: fileId }).toString()}`,
  )
    return local?.size ?? 0
  }

  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(fileId)
    request.onsuccess = () => {
      const result = request.result as StoredFile | undefined
      resolve(result?.size ?? 0)
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * 删除单个文件
 * @param id 文件 ID
 */
export async function deleteFile(id: string): Promise<void> {
  const fileId = requireFileId(id)
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.delete(fileId)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * 清除所有存储的文件
 */
export async function clearAllFiles(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * 获取所有已存储文件的元数据列表
 */
export async function getAllFiles(): Promise<
  { id: string; name: string; ext: string; size: number; uploadedAt: number }[]
> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => {
      const results = (request.result || []) as StoredFile[]
      resolve(
        results.map(f => ({
          id: f.id,
          name: f.name,
          ext: f.ext,
          size: f.size,
          uploadedAt: f.uploadedAt,
        })),
      )
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * 获取 IndexedDB 存储总大小（字节）
 */
export async function getStorageSize(): Promise<number> {
  const files = await getAllFiles()
  return files.reduce((sum, f) => sum + f.size, 0)
}

export async function ensureCourseDirectory(
  courseName: string,
): Promise<{ courseName: string; path: string } | null> {
  const trimmedCourseName = courseName.trim()
  if (!trimmedCourseName) return null
  return fetchJson<{ courseName: string; path: string }>('/api/ensureCourseDir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseName: trimmedCourseName }),
  })
}

export async function listCourseFiles(courseName: string): Promise<
  { path: string; name: string; ext: string; size: number }[]
> {
  const trimmedCourseName = courseName.trim()
  if (!trimmedCourseName) return []
  const params = new URLSearchParams({ courseName: trimmedCourseName })
  return await fetchJson(`/api/listCourseFiles?${params.toString()}`) ?? []
}

export async function openCourseDirectory(courseName: string): Promise<void> {
  const trimmedCourseName = courseName.trim()
  if (!trimmedCourseName) return
  await fetchJson('/api/openCourseDir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseName: trimmedCourseName }),
  })
}

export async function getCourseStorageRoot(): Promise<string | null> {
  const result = await fetchJson<{ path: string }>('/api/getCourseStorageRoot')
  return result?.path ?? null
}

export async function setCourseStorageRoot(path: string): Promise<string | null> {
  return changeLearningDataRoot(async () => {
  const res = await fetch('/api/setCourseStorageRoot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  const result = await responseJson<{ path: string }>(res)
  if (!result.path || !isDiskFilePath(result.path)) throw new Error('存储目录设置失败')
  return result.path
  })
}

export async function selectCourseStorageRoot(): Promise<string | null> {
  const result = await fetchJson<{ path: string | null }>('/api/selectDirectory', {
    method: 'POST',
  })
  return result?.path ?? null
}
