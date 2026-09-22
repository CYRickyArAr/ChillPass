import type { StateStorage } from 'zustand/middleware'

export const LEARNING_KEYS = [
  'chillpass-course-v2', 'chillpass-quiz-progress-v1', 'chillpass-wrong-questions',
  'chillpass-chat', 'chillpass-chat-current', 'athena-storage',
] as const
interface Entry { value: string | null; revision: string }
interface Pending { value: string | null; expectedRevision: string | null; root: string }
const cache = new Map<string, string | null>()
const revisions = new Map<string, string | null>()
const pending = new Map<string, Pending>()
const pendingKey = (key: string) => `chillpass-disk-pending:${key}`
let root = ''
let saving: Promise<void> | null = null
let retryTimer: ReturnType<typeof setTimeout> | undefined
let ready = false
let frozen = false

function notice(message: string) {
  let element = document.getElementById('learning-data-status')
  if (!element) {
    element = document.createElement('div')
    element.id = 'learning-data-status'
    element.setAttribute('role', 'alert')
    element.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:20000;padding:12px 18px;background:#582b20;color:white;border-radius:10px;font:14px/1.5 sans-serif;white-space:pre-wrap'
    document.body.appendChild(element)
  }
  element.textContent = message
  element.hidden = !message
}

async function request(body?: object) {
  const response = await fetch('/api/learningData', {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-ChillPass-Data': '1' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
    cache: 'no-store',
  })
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('本地数据服务不可用，请重启开发服务或使用更新后的完整程序。')
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `保存失败 (${response.status})`)
  return data
}

function stage(key: string, value: Pending) {
  pending.set(key, value)
  try { localStorage.setItem(pendingKey(key), JSON.stringify(value)) }
  catch { notice('浏览器待保存缓冲区已满，正在尝试写入硬盘。保存完成前请勿关闭程序。') }
}

export async function flushLearningData(): Promise<void> {
  clearTimeout(retryTimer)
  if (frozen) return
  if (saving) return saving
  if (!pending.size) return
  saving = (async () => {
    try {
      while (pending.size) {
        const [key, item] = pending.entries().next().value!
        const saved: Entry = await request({ ...item, key })
        revisions.set(key, saved.revision)
        if (pending.get(key) === item) {
          pending.delete(key)
          localStorage.removeItem(pendingKey(key))
        } else {
          stage(key, { ...pending.get(key)!, expectedRevision: saved.revision })
        }
      }
      notice('')
    } catch (error) {
      notice(`学习数据尚未保存到硬盘：${error instanceof Error ? error.message : error}\n请勿清除浏览器数据。程序会重试；若提示冲突，请先保留当前窗口。`)
      retryTimer = setTimeout(() => { void flushLearningData().catch(() => {}) }, 10000)
      throw error
    } finally { saving = null }
  })()
  return saving
}

export const learningDataStorage: StateStorage = {
  getItem: key => cache.get(key) ?? null,
  setItem: (key, value) => {
    if (!ready) throw new Error('学习数据尚未就绪，请稍后再试。')
    if (!LEARNING_KEYS.includes(key as typeof LEARNING_KEYS[number])) throw new Error('未知的学习数据项')
    if (cache.get(key) === value) return
    cache.set(key, value)
    stage(key, { value, root, expectedRevision: revisions.get(key) ?? null })
    // Browser copy is only a cache; pending changes above are kept separately for recovery.
    try { localStorage.setItem(key, value) } catch {}
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => { void flushLearningData().catch(() => {}) }, 120)
  },
  removeItem: key => {
    if (!ready) throw new Error('学习数据尚未就绪')
    cache.set(key, null)
    stage(key, { value: null, root, expectedRevision: revisions.get(key) ?? null })
    localStorage.removeItem(key)
  },
}

/** Runs before any learning store is imported, so defaults cannot overwrite persisted data. */
export async function initializeLearningData() {
  const snapshot: { root: string; entries: Record<string, Entry | null> } = await request()
  root = snapshot.root
  const browserBackup: Record<string, string> = {}
  for (const key of LEARNING_KEYS) {
    const local = localStorage.getItem(key)
    if (local !== null && local !== snapshot.entries[key]?.value) browserBackup[key] = local
  }
  // Preserve original browser values before preferring disk or importing legacy data.
  if (Object.keys(browserBackup).length) await request({ root, backup: browserBackup })
  for (const key of LEARNING_KEYS) {
    const disk = snapshot.entries[key]
    const local = localStorage.getItem(key)
    const buffered = localStorage.getItem(pendingKey(key))
    const item: Pending | null = buffered ? JSON.parse(buffered) : null
    revisions.set(key, disk?.revision ?? null)
    if (item) {
      if (item.root !== root) throw new Error('发现另一数据目录的未保存修改。请切回原目录完成保存后再启动。')
      if (disk?.value === item.value) localStorage.removeItem(pendingKey(key))
      else {
        if (item.expectedRevision !== (disk?.revision ?? null)) throw new Error('未保存修改与硬盘版本冲突。浏览器和硬盘副本均已保留，请先恢复数据，不能自动覆盖。')
        stage(key, item)
      }
    } else if (!disk && local !== null) stage(key, { value: local, expectedRevision: null, root })
    cache.set(key, pending.has(key) ? pending.get(key)!.value : (disk ? disk.value : local))
  }
  await flushLearningData()
  for (const [key, value] of cache) {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch {}
  }
  ready = true
  window.addEventListener('beforeunload', event => {
    if (pending.size) { event.preventDefault(); event.returnValue = '' }
  })
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flushLearningData().catch(() => {}) })
}

export async function changeLearningDataRoot<T>(change: () => Promise<T>): Promise<T> {
  // An old browser preference must never silently switch a disk dataset on startup.
  if (!ready) return change()
  await flushLearningData()
  frozen = true
  try {
    const result = await change()
    const snapshot = await request()
    root = snapshot.root
    for (const [key, item] of pending) stage(key, { ...item, root })
    return result
  } finally {
    frozen = false
    void flushLearningData().catch(() => {})
  }
}
