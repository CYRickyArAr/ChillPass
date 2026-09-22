import type { ExamPoint } from '../types'

const DATABASE = 'chillpass-extraction-checkpoints'
const STORE = 'chunks'
let databasePromise: Promise<IDBDatabase> | undefined

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' })
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Checkpoint database is blocked'))
      request.onsuccess = () => {
        const database = request.result
        database.onversionchange = () => { database.close(); databasePromise = undefined }
        resolve(database)
      }
    }).catch(error => { databasePromise = undefined; throw error })
  }
  return databasePromise
}

/** 只持久化有效考点，不保存 API 密钥；资料/课程/模型/提示词版本不同不会误用旧结果。 */
export async function checkpointKey(parts: unknown[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function readCheckpoint(key: string): Promise<ExamPoint[] | null> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly')
    const request = transaction.objectStore(STORE).get(key)
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
    transaction.oncomplete = () => {
      const points = request.result?.points
      // 空数组不代表成功提炼：允许下次重试，不能永久卡在“恢复全部空结果”。
      resolve(Array.isArray(points) && points.length > 0 && points.every(point => typeof point?.id === 'string' && typeof point?.title === 'string') ? points : null)
    }
  })
}

export async function saveCheckpoint(key: string, points: ExamPoint[]): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put({ key, points, savedAt: Date.now() })
    // request.onsuccess 尚不能保证落盘，必须等整个事务提交后再增加已完成计数。
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

/** 仅供用户确认“清除所有数据”时调用，普通失败和取消绝不清理断点。 */
export async function clearExtractionCheckpoints(): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).clear()
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
