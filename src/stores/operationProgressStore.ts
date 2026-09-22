import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type OperationKind = 'extract' | 'lesson' | 'question' | 'grade' | 'review' | 'exam' | 'translate' | 'chat' | 'task' | 'memory' | 'parse' | 'batch'
export type OperationStage = 'preparing' | 'processing' | 'queued' | 'waiting' | 'receiving' | 'retrying' | 'validating' | 'extracting' | 'consolidating' | 'done' | 'failed' | 'cancelled' | 'interrupted'
export interface OperationProgress {
  id: string
  kind: OperationKind
  detail: string
  stage: OperationStage
  phase?: 'extracting' | 'consolidating'
  reusedChunks?: number
  skippedSources?: string[]
  duplicateSources?: number
  localMerge?: boolean
  current?: number
  total?: number
  unit?: 'chunks' | 'pages' | 'lessons' | 'files'
  source?: string
  fileIndex?: number
  fileTotal?: number
  chunkIndex?: number
  chunkTotal?: number
  attempt?: number
  maxAttempts?: number
  validationRetry?: number
  truncationRetries?: number
  outputTokens?: number
  receivedChars?: number
  failed?: number
  error?: string
  retryHint?: string
  startedAt: number
  updatedAt: number
  finishedAt?: number
}
export type ProgressPatch = Partial<Omit<OperationProgress, 'id' | 'kind' | 'startedAt'>> & { reusedChunk?: boolean }
export type ProgressReporter = (patch: ProgressPatch) => void
export const isOperationActive = (item: OperationProgress) => !['done', 'failed', 'cancelled', 'interrupted'].includes(item.stage)

/** Persist concise diagnostics, never an unbounded response or a bearer/API credential. */
export function operationErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[a-z0-9_-]+/gi, '[redacted]').slice(0, 800)
}

interface OperationState {
  items: OperationProgress[]
  expanded: boolean
  begin: (kind: OperationKind, detail: string) => string
  patch: (id: string, patch: ProgressPatch) => void
  finishMatching: (predicate: (item: OperationProgress) => boolean, stage: Extract<OperationStage, 'cancelled' | 'interrupted' | 'failed' | 'done'>) => void
  setExpanded: (expanded: boolean) => void
}

export const useOperationProgressStore = create<OperationState>()(persist((set) => ({
  items: [],
  expanded: true,
  begin: (kind, detail) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const now = Date.now()
    set(state => ({ items: [
      { id, kind, detail, stage: 'preparing', startedAt: now, updatedAt: now },
      ...state.items.filter(isOperationActive),
      ...state.items.filter(item => !isOperationActive(item)).slice(0, 19),
    ] }))
    return id
  },
  patch: (id, patch) => set(state => ({ items: state.items.map(item => {
    if (item.id !== id) return item
    const next = { ...item, ...patch, updatedAt: Date.now() }
    // Once a task is explicitly cancelled/failed/interrupted, late network progress
    // must not revive the tray into a running state again.
    if (!isOperationActive(item)) {
      return { ...next, stage: item.stage, finishedAt: item.finishedAt }
    }
    return next
  }) })),
  finishMatching: (predicate, stage) => set(state => {
    const now = Date.now()
    return {
      items: state.items.map(item => predicate(item) && isOperationActive(item)
        ? { ...item, stage, updatedAt: now, finishedAt: now }
        : item),
    }
  }),
  setExpanded: expanded => set({ expanded }),
}), {
  name: 'chillpass-operation-progress',
  version: 1,
  partialize: state => ({ items: state.items, expanded: state.expanded }),
  merge: (persisted, current) => {
    const saved = persisted as Partial<OperationState> | undefined
    return {
      ...current,
      expanded: saved?.expanded ?? true,
      // 浏览器刷新终止旧请求；保留最后计数，并明确标为中断，不能冒充仍在生成。
      items: (saved?.items ?? []).map(item => isOperationActive(item)
        ? { ...item, stage: 'interrupted' as const, finishedAt: item.updatedAt }
        : item),
    }
  },
}))

export function beginOperation(kind: OperationKind, detail = '', listener?: ProgressReporter) {
  const id = useOperationProgressStore.getState().begin(kind, detail)
  let currentStage: OperationStage = 'preparing'
  let reusedChunks = 0
  const report: ProgressReporter = patch => {
    if (patch.stage) currentStage = patch.stage
    const { reusedChunk, ...update } = patch
    if (reusedChunk) update.reusedChunks = ++reusedChunks
    useOperationProgressStore.getState().patch(id, update)
    listener?.(update)
  }
  return { report, finish: (stage: OperationStage) => report({
    stage: stage === 'done' && ['failed', 'cancelled', 'interrupted'].includes(currentStage) ? currentStage : stage,
    finishedAt: Date.now(),
  }) }
}

/** 操作的成功状态在解析及校验完成后写入，而不是收到 HTTP 响应就算成功。 */
export async function trackOperation<T>(kind: OperationKind, detail: string, work: (report: ProgressReporter) => Promise<T>, listener?: ProgressReporter): Promise<T> {
  const operation = beginOperation(kind, detail, listener)
  try {
    const result = await work(operation.report)
    const unavailable = result && typeof result === 'object' && 'status' in result && result.status === 'unavailable'
    operation.finish(unavailable ? 'failed' : 'done')
    return result
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) operation.report({ error: operationErrorText(error) })
    operation.finish(error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed')
    throw error
  }
}
