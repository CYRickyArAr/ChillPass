import type { StateStorage } from 'zustand/middleware'

export const LEARNING_KEYS = [
  'chillpass-course-v2', 'chillpass-quiz-progress-v1', 'chillpass-wrong-questions',
  'chillpass-chat', 'chillpass-chat-current', 'athena-storage',
] as const
interface Entry { value: string | null; revision: string; savedAt?: string }
interface Pending { value: string | null; expectedRevision: string | null; root: string }
type LearningKey = typeof LEARNING_KEYS[number]
interface Snapshot { root: string; entries: Record<string, Entry | null> }
export interface LearningDataConflict {
  key: LearningKey
  disk: Entry | null
  browser: Pending
  buffered: string
}
export class LearningDataConflictError extends Error {
  constructor(public readonly snapshot: Snapshot, public readonly conflicts: LearningDataConflict[]) {
    super('浏览器未保存修改与硬盘版本冲突，请选择要继续使用的版本。')
    this.name = 'LearningDataConflictError'
  }
}
const cache = new Map<string, string | null>()
const revisions = new Map<string, string | null>()
const pending = new Map<string, Pending>()
const pendingKey = (key: string) => `chillpass-disk-pending:${key}`
let root = ''
let saving: Promise<void> | null = null
let retryTimer: ReturnType<typeof setTimeout> | undefined
let ready = false
let frozen = false

let currentNotice = ''
let dismissedNotice = ''

function notice(message: string) {
  currentNotice = message
  // 保存恢复后重置关闭状态；同一错误的后台重试不反复弹出。
  if (!message) dismissedNotice = ''
  let element = document.getElementById('learning-data-status')
  if (!message || message === dismissedNotice) {
    if (element) element.hidden = true
    return
  }
  if (!element) {
    element = document.createElement('div')
    element.id = 'learning-data-status'
    element.setAttribute('role', 'alert')
    document.body.appendChild(element)
  }
  let copy = element.querySelector<HTMLElement>('[data-learning-data-message]')
  if (!copy) {
    copy = document.createElement('span')
    copy.dataset.learningDataMessage = ''
    copy.style.cssText = 'flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto'
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = '×'
    close.title = '关闭提示（不会取消保存或清除数据）'
    close.setAttribute('aria-label', close.title)
    close.style.cssText = 'flex:0 0 28px;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;font:22px/1 sans-serif;cursor:pointer'
    const container = element
    close.addEventListener('click', () => {
      dismissedNotice = currentNotice
      container.hidden = true
    })
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:10px;align-items:flex-start'
    row.append(copy, close)
    element.replaceChildren(row)
  }
  // 外层不设置 display，避免覆盖浏览器的 hidden 样式。
  element.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:20000;box-sizing:border-box;width:min(640px,calc(100vw - 24px));padding:12px 14px;background:#582b20;color:white;border-radius:10px;font:14px/1.5 sans-serif'
  copy.textContent = message
  element.hidden = false
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
  catch { /* Browser cache is optional; disk-save failures are reported by flushLearningData. */ }
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

/** Runs only on the startup recovery screen, before any learning store is imported. */
export async function recoverLearningData(error: LearningDataConflictError, choices: Record<string, 'disk' | 'browser'>) {
  if (ready || saving) throw new Error('数据服务已在运行，请重新加载后恢复。')
  clearTimeout(retryTimer)
  pending.clear()
  const snapshot: Snapshot = await request()
  if (snapshot.root !== error.snapshot.root) throw new Error('数据目录已变化，请重新加载后再选择。')
  const backup: Record<string, string> = {
    'recovery-snapshot': JSON.stringify(snapshot),
    'recovery-choices': JSON.stringify(choices),
  }
  for (const key of LEARNING_KEYS) {
    if ((snapshot.entries[key]?.revision ?? null) !== (error.snapshot.entries[key]?.revision ?? null)) {
      throw new Error('硬盘数据又发生了变化，请暂停其他窗口的操作，重新加载后再选择。')
    }
    const local = localStorage.getItem(key)
    const buffered = localStorage.getItem(pendingKey(key))
    if (local !== null) backup[key] = local
    if (buffered !== null) backup[pendingKey(key)] = buffered
  }
  for (const conflict of error.conflicts) {
    if (!['disk', 'browser'].includes(choices[conflict.key])) throw new Error('请为每一项冲突选择版本。')
    if (localStorage.getItem(pendingKey(conflict.key)) !== conflict.buffered) {
      throw new Error('浏览器待保存内容已变化，请暂停其他窗口的操作，重新加载后再选择。')
    }
  }
  // This existing API writes and verifies a separate backup file before any recovery mutation.
  await request({ root: snapshot.root, backup })
  for (const conflict of error.conflicts) {
    if (localStorage.getItem(pendingKey(conflict.key)) !== conflict.buffered) {
      throw new Error('恢复期间浏览器内容已变化，已停止；备份已保留，请重新加载。')
    }
    if (choices[conflict.key] === 'browser') {
      // Keep optimistic locking: never force a write over a newer disk revision.
      await request({ root: snapshot.root, key: conflict.key, value: conflict.browser.value,
        expectedRevision: conflict.disk?.revision ?? null })
    }
    if (localStorage.getItem(pendingKey(conflict.key)) !== conflict.buffered) {
      throw new Error('恢复期间出现新的待保存修改，未清除新修改，请重新加载。')
    }
    // The unselected copy is archived; unrelated pending records are untouched.
    localStorage.removeItem(pendingKey(conflict.key))
  }
}

/** Runs before any learning store is imported, so defaults cannot overwrite persisted data. */
export async function initializeLearningData() {
  const snapshot: Snapshot = await request()
  root = snapshot.root
  clearTimeout(retryTimer)
  pending.clear()
  const conflicts: LearningDataConflict[] = []
  // Inspect every key before clearing pending records or starting any writes.
  for (const key of LEARNING_KEYS) {
    const buffered = localStorage.getItem(pendingKey(key))
    if (!buffered) continue
    const item: Pending = JSON.parse(buffered)
    if (item.root !== root) throw new Error('发现另一数据目录的未保存修改。请切回原目录完成保存后再启动。')
    const disk = snapshot.entries[key] ?? null
    if (disk?.value !== item.value && item.expectedRevision !== (disk?.revision ?? null)) {
      conflicts.push({ key, disk, browser: item, buffered })
    }
  }
  if (conflicts.length) throw new LearningDataConflictError(snapshot, conflicts)
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
        // A different window may have replaced its pending record during the backup request.
        if (item.expectedRevision !== (disk?.revision ?? null)) {
          pending.clear()
          throw new LearningDataConflictError(snapshot, [{ key, disk: disk ?? null, browser: item, buffered: buffered! }])
        }
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
