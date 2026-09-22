import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ListChecks, LoaderCircle } from 'lucide-react'
import { useCourseStore } from '@stores/courseStore'
import { isOperationActive, useOperationProgressStore, type OperationProgress as Progress } from '@stores/operationProgressStore'
import { useT } from '../../i18n'
import styles from './OperationProgress.module.css'
import ReadyLessonNotice from './ReadyLessonNotice'

function useClock(running: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  return now
}

export function OperationProgressCard({ item, now = Date.now() }: { item: Progress; now?: number }) {
  const t = useT()
  const active = isOperationActive(item)
  const countKnown = typeof item.total === 'number' && item.total > 0
  // 分段全部提炼完成后仍有合并步骤，不以 100% 冒充整个任务完成。
  const known = countKnown && item.stage !== 'consolidating' && !(item.phase === 'consolidating' && item.stage !== 'done') && !(item.stage === 'failed' && item.current === item.total)
  const percent = known ? Math.min(100, Math.max(0, Math.floor((item.current ?? 0) / item.total! * 100))) : undefined
  const seconds = Math.max(0, Math.floor(((item.finishedAt ?? now) - item.startedAt) / 1000))
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <div className={styles.card}>
      <div className={styles.heading}>
        <strong>{t(`progress.${item.kind}`)}{item.detail && ` · ${item.detail}`}</strong>
        {known && <span className={styles.percent}>{percent}%</span>}
      </div>
      <div className={styles.meta}>
        <span>{t(`progress.${item.stage}`)}</span>
        {countKnown && <span>{t('progress.count').replace('{current}', String(item.current ?? 0)).replace('{total}', String(item.total))} {item.unit ? t(`progress.${item.unit}`) : ''}</span>}
        {item.startedAt > 0 && <span>{t('progress.elapsed').replace('{time}', time)}</span>}
        {!!item.attempt && active && <span>{t(item.maxAttempts ? 'progress.attempt' : 'progress.requestNumber').replace('{current}', String(item.attempt)).replace('{total}', String(item.maxAttempts))}</span>}
        {!!item.validationRetry && <span>{t('progress.validationRetry').replace('{count}', String(item.validationRetry))}</span>}
        {!!item.truncationRetries && <span>{t('progress.truncationRetries').replace('{count}', String(item.truncationRetries))}</span>}
        {!!item.outputTokens && <span>{t('progress.outputTokens').replace('{limit}', String(item.outputTokens))}</span>}
        {!!item.receivedChars && <span>{t('progress.chars').replace('{count}', String(item.receivedChars))}</span>}
        {!!item.failed && <span className={styles.warning}>{t('progress.failedCount').replace('{count}', String(item.failed))}</span>}
        {!!item.reusedChunks && <span>{t('progress.reusedChunks').replace('{count}', String(item.reusedChunks))}</span>}
        {!!item.duplicateSources && <span>{t('progress.duplicateSources').replace('{count}', String(item.duplicateSources))}</span>}
      </div>
      {item.localMerge && <div className={styles.source}>{t('progress.localMerge')}</div>}
      {item.retryHint && <div className={styles.source}>{item.retryHint}</div>}
      {item.error && <div className={`${styles.source} ${styles.warning}`} role="status">{t('progress.failureReason')} {item.error}</div>}
      {!!item.skippedSources?.length && <div className={`${styles.source} ${styles.warning}`}>{t('progress.skippedSources').replace('{names}', item.skippedSources.join('、'))}</div>}
      {item.source && <div className={styles.source}>
        {item.fileTotal ? `${t('progress.file').replace('{current}', String(item.fileIndex ?? 1)).replace('{total}', String(item.fileTotal))} · ` : ''}
        {item.source}
        {item.chunkTotal ? ` · ${t('progress.chunk').replace('{current}', String(item.chunkIndex ?? 1)).replace('{total}', String(item.chunkTotal))}` : ''}
      </div>}
      <div className={styles.bar} role="progressbar" aria-label={t(`progress.${item.kind}`)}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={t(`progress.${item.stage}`)}>
        <div className={`${styles.fill} ${!known && active ? styles.indeterminate : ''}`}
          style={known ? { width: `${percent}%` } : !active ? { width: item.stage === 'done' ? '100%' : '0%' } : undefined} />
      </div>
    </div>
  )
}

function operationDisplayKey(item: Progress): string {
  const detail = item.detail?.trim()
  if (!detail) return item.id
  return `${item.kind}:${detail}`
}

function operationPercentScore(item: Progress): number {
  if (item.stage === 'done') return 1
  if (typeof item.total !== 'number' || item.total <= 0) return -1
  return Math.min(1, Math.max(0, (item.current ?? 0) / item.total))
}

function operationStageScore(item: Progress): number {
  if (isOperationActive(item)) return 5
  if (item.stage === 'done') return 4
  if (item.stage === 'failed') return 3
  if (item.stage === 'interrupted') return 2
  if (item.stage === 'cancelled') return 1
  return 0
}

function isBetterOperationProgress(candidate: Progress, current: Progress): boolean {
  const candidateStage = operationStageScore(candidate)
  const currentStage = operationStageScore(current)
  if (candidateStage !== currentStage) return candidateStage > currentStage

  const candidatePercent = operationPercentScore(candidate)
  const currentPercent = operationPercentScore(current)
  if (candidatePercent !== currentPercent) return candidatePercent > currentPercent

  const candidateTime = candidate.finishedAt ?? candidate.updatedAt ?? candidate.startedAt
  const currentTime = current.finishedAt ?? current.updatedAt ?? current.startedAt
  return candidateTime > currentTime
}

function dedupeVisibleProgress(items: Progress[]): Progress[] {
  const bestByKey = new Map<string, Progress>()
  for (const item of items) {
    const key = operationDisplayKey(item)
    const current = bestByKey.get(key)
    if (!current || isBetterOperationProgress(item, current)) bestByKey.set(key, item)
  }
  return items.filter(item => bestByKey.get(operationDisplayKey(item)) === item)
}

function shouldShowInTray(item: Progress, completedKeys: Set<string>): boolean {
  if (item.stage === 'done' || item.stage === 'cancelled') return false
  if (completedKeys.has(operationDisplayKey(item))) return false
  if (isOperationActive(item)) return true
  return item.stage === 'interrupted' || item.stage === 'failed'
}

/** 顶部任务托盘；默认只占一个图标，展开后显示生成、导入、优化等长任务进度。 */
export default function OperationProgressCenter() {
  const t = useT()
  const items = useOperationProgressStore(s => s.items)
  const expanded = useOperationProgressStore(s => s.expanded)
  const setExpanded = useOperationProgressStore(s => s.setExpanded)
  const trayRef = useRef<HTMLElement | null>(null)
  const courses = useCourseStore(s => s.courses)
  const currentCourseId = useCourseStore(s => s.currentCourseId)
  const currentBundle = courses.find(bundle => bundle.course.id === currentCourseId)
  const courseTasks: Progress[] = []
  for (const bundle of courses) {
    const job = bundle.optimizationJob
    if (job) {
      const processed = Object.values(job.items).filter(item => item.state === 'done' || item.state === 'failed')
      courseTasks.push({
        id: job.id, kind: job.kind === 'batch' ? 'batch' : 'lesson', detail: bundle.course.name,
        stage: job.status === 'paused' ? 'interrupted'
          : job.status === 'cancelled' ? 'cancelled'
          : job.status === 'failed' || (job.status === 'completed' && (job.scanFailed || processed.some(item => item.state === 'failed'))) ? 'failed'
          : job.status === 'completed' ? 'done'
          : job.phase === 'scanning' ? 'extracting' : 'processing',
        current: job.phase === 'scanning' ? undefined : processed.length,
        total: job.phase === 'scanning' ? undefined : job.targetLessonIds.length, unit: 'lessons',
        failed: processed.filter(item => item.state === 'failed').length,
        startedAt: job.startedAt, updatedAt: job.updatedAt,
        finishedAt: job.status !== 'running' ? job.updatedAt : undefined,
      })
    }
    if ((!job || !['running', 'paused'].includes(job.status)) && (bundle.generatingLessons || bundle.generationPaused) && !items.some(item => item.kind === 'lesson' && item.detail === bundle.course.name && item.total !== undefined && isOperationActive(item))) {
      courseTasks.push({
        id: `generation:${bundle.course.id}`, kind: 'lesson', detail: bundle.course.name,
        stage: bundle.generatingLessons ? 'processing' : 'interrupted',
        current: bundle.generationProgress.current, total: bundle.generationProgress.total,
        unit: 'lessons', startedAt: 0, updatedAt: 0,
      })
    }
    const preparation = bundle.preparationProgress
    if (preparation?.stage === 'parsing') {
      courseTasks.push({
        id: `preparation:${bundle.course.id}`, kind: 'parse', detail: bundle.course.name,
        stage: 'preparing', current: preparation.current, total: preparation.total,
        unit: 'files', startedAt: 0, updatedAt: 0,
      })
    }
  }
  const active = items.filter(isOperationActive)
  const running = active.length + courseTasks.filter(isOperationActive).length
  const now = useClock(running > 0)
  useEffect(() => {
    if (!expanded) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!trayRef.current?.contains(event.target as Node)) setExpanded(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('pointerdown', closeOnOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [expanded, setExpanded])

  const orderedItems = [
    ...courseTasks.filter(isOperationActive),
    ...active,
    ...courseTasks.filter(item => !isOperationActive(item)),
    ...items.filter(item => !isOperationActive(item)),
  ]
  const completedKeys = new Set(orderedItems
    .filter(item => item.stage === 'done')
    .map(operationDisplayKey))
  const visible = dedupeVisibleProgress([
    ...orderedItems.filter(item => shouldShowInTray(item, completedKeys)),
  ])
  if (!visible.length) return null
  const activeWithCount = visible.filter(item => isOperationActive(item) && typeof item.total === 'number' && item.total > 0)
  const currentTotal = activeWithCount.reduce((sum, item) => sum + (item.current ?? 0), 0)
  const grandTotal = activeWithCount.reduce((sum, item) => sum + (item.total ?? 0), 0)
  const trayPercent = grandTotal > 0 ? Math.min(100, Math.max(0, Math.floor((currentTotal / grandTotal) * 100))) : undefined
  const badgeCount = running > 0 ? running : Math.min(visible.length, 99)
  const subtitle = running > 0 ? t('progress.active').replace('{count}', String(running)) : t('progress.history')
  return (
    <section className={styles.tray} aria-label={t('progress.title')} ref={trayRef}>
      <button
        className={`${styles.trayButton} ${running > 0 ? styles.trayButtonActive : ''}`}
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="operation-progress-popover"
        title={`${t('progress.title')} · ${subtitle}`}
      >
        <span className={styles.iconShell} aria-hidden="true">
          {running > 0 ? <LoaderCircle size={17} className={styles.spinner} /> : <ListChecks size={17} />}
        </span>
        <span className={styles.trayText}>
          <strong>{t('progress.title')}</strong>
          <small>{subtitle}</small>
        </span>
        {trayPercent !== undefined ? (
          <span className={styles.miniPercent}>{trayPercent}%</span>
        ) : badgeCount > 0 ? (
          <span className={styles.badge}>{badgeCount}</span>
        ) : null}
        <ChevronDown size={14} className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`} aria-hidden="true" />
      </button>
      {expanded && (
        <div id="operation-progress-popover" className={styles.popover} role="dialog" aria-label={t('progress.title')}>
          <div className={styles.popoverHeader}>
            <div>
              <strong>{t('progress.title')}</strong>
              <span>{subtitle}</span>
            </div>
            {trayPercent !== undefined && <b>{trayPercent}%</b>}
          </div>
          <ReadyLessonNotice key={currentCourseId} bundle={currentBundle} />
          {visible.length > 0 && (
            <div id="operation-progress-list" className={styles.list}>
              {visible.map(item => <OperationProgressCard key={item.id} item={item} now={now} />)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** 页面内显示当前类型的最新请求，与跨页面进度使用同一条记录。 */
export function LatestOperationProgress({ kind, detail }: { kind: Progress['kind']; detail?: string }) {
  const item = useOperationProgressStore(s => s.items.find(item => item.kind === kind && (detail === undefined || item.detail === detail)))
  const now = useClock(!!item && isOperationActive(item))
  return item ? <OperationProgressCard item={item} now={now} /> : null
}
