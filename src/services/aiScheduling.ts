export type AiPriority = 'interactive' | 'background'
export const BACKGROUND_CONCURRENCY = 4

export const abortError = () => new DOMException('Aborted', 'AbortError')

/** Shared across courses: reserve two connections for chat, summaries and grading. */
export class AiRequestScheduler {
  private active = 0
  private background = 0
  private queue: { priority: AiPriority; signal?: AbortSignal; start: () => void; cancel: () => void }[] = []

  constructor(private readonly limit = 6, private readonly backgroundLimit = BACKGROUND_CONCURRENCY) {}

  acquire(priority: AiPriority = 'interactive', signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError())
    return new Promise((resolve, reject) => {
      const entry = { priority, signal, start: () => {}, cancel: () => {} }
      entry.cancel = () => {
        this.queue = this.queue.filter(item => item !== entry)
        signal?.removeEventListener('abort', entry.cancel)
        reject(abortError())
        this.drain()
      }
      entry.start = () => {
        signal?.removeEventListener('abort', entry.cancel)
        this.active++
        if (priority === 'background') this.background++
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.active--
          if (priority === 'background') this.background--
          this.drain()
        })
      }
      signal?.addEventListener('abort', entry.cancel, { once: true })
      this.queue.push(entry)
      this.drain()
    })
  }

  private drain() {
    while (this.active < this.limit) {
      let index = this.queue.findIndex(item => item.priority === 'interactive')
      if (index < 0 && this.background < this.backgroundLimit) index = this.queue.findIndex(item => item.priority === 'background')
      if (index < 0) return
      this.queue.splice(index, 1)[0].start()
    }
  }
}

export const aiRequests = new AiRequestScheduler()

/** Ordered output, independent workers; on fatal failure stop and settle siblings before returning. */
export async function mapConcurrent<T, R>(items: readonly T[], limit: number,
  work: (item: T, index: number, signal: AbortSignal) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) controller.abort()
  const results: R[] = new Array(items.length)
  let cursor = 0
  let failed = false
  let failure: unknown
  try {
    await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, Math.floor(limit))) }, async () => {
      while (!controller.signal.aborted && cursor < items.length) {
        const index = cursor++
        try { results[index] = await work(items[index], index, controller.signal) }
        catch (error) {
          if (!failed) { failed = true; failure = error }
          controller.abort()
        }
      }
    }))
    if (signal?.aborted) throw abortError()
    if (failed) throw failure
    return results
  } finally { signal?.removeEventListener('abort', cancel) }
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(abortError()) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve() }, ms)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}
