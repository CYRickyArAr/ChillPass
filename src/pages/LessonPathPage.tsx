import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle, PlayCircle, Upload, Loader, FileText, ChevronDown, ChevronRight, RefreshCw, ShieldCheck, CircleStop, Play } from 'lucide-react'
import { useCourseStore, useCurrentBundle } from '@stores/courseStore'
import { cancelLessonGeneration, generateAllLessonsInBackground } from '@services/lessonGenerator'
import { cancelCourseOptimization, rebuildCourseLessonStructure, startBatchCourseOptimization } from '@services/courseOptimizer'
import { useT } from '../i18n'
import type { TranslationKey } from '../i18n'
import type { Lesson, Priority } from '@types/index'
import styles from './LessonPathPage.module.css'
import LessonCostEstimate from '../components/common/LessonCostEstimate'
import { getGenerationRecovery } from '../utils/generationRecovery'

const priorityLabelKey: Record<Priority, TranslationKey> = {
  must: 'dashboard.priorityMust',
  high: 'dashboard.priorityHigh',
  know: 'dashboard.priorityKnow',
}

interface LessonGroup {
  key: string
  lessons: Lesson[]
}

function stripSourceExtension(source: string): string {
  return source
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/\.[a-z0-9]{1,8}$/i, '')
    .trim() || source.trim()
}

function isGenericSourceName(source: string): boolean {
  const base = stripSourceExtension(source)
    .replace(/[_\-\s]+/g, '')
    .toLowerCase()

  if (!base) return true
  if (/^\d{1,4}$/.test(base)) return true
  if (/^第?\d{1,4}(讲|章|节|课|周|次)?$/.test(base)) return true
  if (/^(chapter|chap|lecture|lec|lesson|part|ppt|pdf|slides?|courseware|课件|讲义|材料)\d{0,4}$/.test(base)) return true
  if (/^(第)?\d{1,4}(lecture|lesson|chapter|课件|讲义|材料)$/.test(base)) return true
  return false
}

function cleanLessonTitleForGroup(title: string): string {
  return title
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/^\s*(第\s*)?\d{1,4}\s*[、.．\-_:：]?\s*/i, '')
    .replace(/^\s*(chapter|lecture|lesson|part)\s*\d{1,4}\s*[、.．\-_:：]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getLessonGroupKey(lesson: Lesson, defaultGroup: string): string {
  return lesson.sourceFile ? stripSourceExtension(lesson.sourceFile) : defaultGroup
}

function getGroupDisplayTitle(source: string, groupLessons: Lesson[]): string {
  const fileTitle = stripSourceExtension(source)
  if (!isGenericSourceName(source)) return fileTitle

  const candidate = groupLessons
    .map(lesson => cleanLessonTitleForGroup(lesson.title))
    .find(title => title && !isGenericSourceName(title))

  return candidate || fileTitle || source
}

function getGroupSourceTooltip(groupLessons: Lesson[]): string {
  return Array.from(new Set(groupLessons.map(lesson => lesson.sourceFile).filter(Boolean))).join(' / ')
}

function getInitialCollapsedGroups(lessonGroups: LessonGroup[]): Set<string> {
  const collapsed = new Set<string>()

  lessonGroups.forEach(group => {
    if (group.lessons.length <= 1) return
    const allDone = group.lessons.length > 0 && group.lessons.every(lesson => lesson.status === 'completed')
    if (allDone) collapsed.add(group.key)
  })

  return collapsed
}

export default function LessonPathPage() {
  const t = useT()
  const navigate = useNavigate()
  const bundle = useCurrentBundle()
  const clearCompletedProgress = useCourseStore(s => s.clearCompletedProgress)
  const course = bundle?.course
  const lessons = bundle?.lessons ?? []
  const lastStudiedLesson = lessons.find(lesson => lesson.id === bundle?.lastStudiedLessonId)
  const lastStudiedGroup = lastStudiedLesson ? getLessonGroupKey(lastStudiedLesson, t('lessons.defaultGroup')) : null
  const lastStudiedRowRef = useRef<HTMLButtonElement>(null)
  const restoredPositionRef = useRef<string | null>(null)
  const progress = bundle?.progress
  const generatingLessons = bundle?.generatingLessons ?? false
  const generationProgress = bundle?.generationProgress ?? { current: 0, total: 0 }
  const { canRetry: canRetryGeneration, pending: pendingGeneration } = getGenerationRecovery(bundle)
  const optimizationJob = bundle?.optimizationJob
  const optimizationActive = optimizationJob?.status === 'running' || optimizationJob?.status === 'paused'
  const [showBatchConfirm, setShowBatchConfirm] = useState(false)
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false)
  const [showClearCompletedConfirm, setShowClearCompletedConfirm] = useState(false)
  const [rebuildingStructure, setRebuildingStructure] = useState(false)
  const [rebuildResult, setRebuildResult] = useState<string | null>(null)
  const [rebuildError, setRebuildError] = useState<string | null>(null)
  const [clearCompletedResult, setClearCompletedResult] = useState<string | null>(null)
  const batchRunning = optimizationJob?.kind === 'batch' && optimizationJob.status === 'running'
  const processedBatchItems = optimizationJob?.kind === 'batch'
    ? Object.values(optimizationJob.items).filter(item => item.state === 'done' || item.state === 'failed').length
    : 0
  const processingLessonId = optimizationJob?.kind === 'batch'
    ? Object.values(optimizationJob.items).find(item => item.state === 'processing')?.lessonId
    : undefined
  const batchProgress = optimizationJob?.kind === 'batch'
    ? {
        current: processedBatchItems + (processingLessonId ? 1 : 0),
        total: optimizationJob.targetLessonIds.length || lessons.length,
        title: optimizationJob.phase === 'scanning'
          ? t('lessons.batchScanning')
          : lessons.find(lesson => lesson.id === processingLessonId)?.title ?? '',
      }
    : { current: 0, total: 0, title: '' }
  const batchResult = optimizationJob?.kind === 'batch' && optimizationJob.status === 'completed' && optimizationJob.summary
    ? t('lessons.batchResult')
        .replace('{added}', String(optimizationJob.summary.added))
        .replace('{success}', String(optimizationJob.summary.success))
        .replace('{failed}', String(optimizationJob.summary.failed))
        .replace('{scanStatus}', optimizationJob.scanFailed ? t('lessons.batchScanFailed') : '')
    : null
  const batchCancelled = optimizationJob?.kind === 'batch' && optimizationJob.status === 'cancelled'
  const batchFailed = optimizationJob?.kind === 'batch' && optimizationJob.status === 'failed'
    ? optimizationJob.error ?? t('lessons.batchFailed')
    : null

  // 按 PPT/PDF 来源文件分组；提炼去重仍在考点生成阶段完成。
  const groupedLessons = useMemo(() => {
    return lessons.reduce((acc, lesson) => {
      const key = getLessonGroupKey(lesson, t('lessons.defaultGroup'))
      if (!acc[key]) acc[key] = []
      acc[key].push(lesson)
      return acc
    }, {} as Record<string, Lesson[]>)
  }, [lessons, t])

  const lessonGroups = useMemo(() => {
    return Object.entries(groupedLessons).map(([key, groupLessons]) => ({
      key,
      lessons: groupLessons,
    }))
  }, [groupedLessons])

  // 首帧直接得到最终折叠状态，避免挂载后先折叠、再展开所造成的布局跳动。
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => {
      const initial = getInitialCollapsedGroups(lessonGroups)
      if (lastStudiedGroup) initial.delete(lastStudiedGroup)
      return initial
    },
  )

  useLayoutEffect(() => {
    const restoreKey = `${course?.id}:${lastStudiedLesson?.id}`
    if (!lastStudiedLesson || restoredPositionRef.current === restoreKey) return
    if (lastStudiedGroup && collapsedGroups.has(lastStudiedGroup)) {
      setCollapsedGroups(prev => {
        const next = new Set(prev)
        next.delete(lastStudiedGroup)
        return next
      })
      return
    }
    const row = lastStudiedRowRef.current
    if (!row) return
    // Only scroll the lesson pane, never the Athena panel or the outer window.
    let container = row.parentElement
    while (container && !/(auto|scroll)/.test(getComputedStyle(container).overflowY)) {
      container = container.parentElement
    }
    if (container) {
      container.scrollTo({
        top: container.scrollTop + row.getBoundingClientRect().top - container.getBoundingClientRect().top - 80,
        behavior: 'instant',
      })
      restoredPositionRef.current = restoreKey
    }
  }, [course?.id, lastStudiedLesson?.id, lastStudiedGroup, collapsedGroups])

  // 学习进度变化后收起已完成分组；用户仍可手动展开或折叠任意分组。
  useEffect(() => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      let changed = false

      lessonGroups.forEach(group => {
        if (group.key === lastStudiedGroup) return
        if (group.lessons.length <= 1) {
          if (next.delete(group.key)) changed = true
          return
        }
        const allDone = group.lessons.length > 0 && group.lessons.every(lesson => lesson.status === 'completed')

        if (allDone && !next.has(group.key)) {
          next.add(group.key)
          changed = true
        }
      })

      return changed ? next : prev
    })
  }, [lessonGroups, lastStudiedGroup])

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // 空状态：没有课程或没有关卡
  if (!course || !progress || lessons.length === 0) {
    return (
      <div className={styles.page}>
        <div className={`${styles.empty} liquid-glass`}>
          <div className={styles.emptyIcon}>
            <PlayCircle size={48} strokeWidth={1.4} />
          </div>
          <h2 className={styles.emptyTitle}>{t('lessons.emptyTitle')}</h2>
          <p className={styles.emptyText}>
            {t('lessons.emptyDesc')}
          </p>
          <button
            className={styles.emptyButton}
            onClick={() => navigate('/upload')}
          >
            <Upload size={18} strokeWidth={2} />
            <span>{t('lessons.goImport')}</span>
          </button>
        </div>
      </div>
    )
  }

  const percent =
    progress.totalLessons > 0
      ? Math.round((progress.completedLessons / progress.totalLessons) * 100)
      : 0

  const handleLessonClick = (lesson: Lesson) => {
    navigate(`/lessons/${lesson.id}`)
  }

  const handleBatchRegenerate = () => {
    if (!course || optimizationActive || generatingLessons) return
    setShowBatchConfirm(false)
    setClearCompletedResult(null)
    startBatchCourseOptimization(course.id)
  }

  const handleRebuildStructure = async () => {
    if (!course || optimizationActive || generatingLessons || rebuildingStructure) return
    setShowRebuildConfirm(false)
    setRebuildResult(null)
    setRebuildError(null)
    setClearCompletedResult(null)
    setRebuildingStructure(true)
    try {
      const result = await rebuildCourseLessonStructure(course.id)
      if (!result) {
        setRebuildError(t('lessons.rebuildFailed'))
        return
      }
      setRebuildResult(t('lessons.rebuildResult')
        .replace('{before}', String(result.before))
        .replace('{after}', String(result.after))
        .replace('{reused}', String(result.reused))
        .replace('{pending}', String(result.pending)))
    } catch {
      setRebuildError(t('lessons.rebuildFailed'))
    } finally {
      setRebuildingStructure(false)
    }
  }

  const handleClearCompleted = () => {
    if (!course || progress.completedLessons <= 0) return
    clearCompletedProgress(course.id)
    setShowClearCompletedConfirm(false)
    setClearCompletedResult(t('lessons.clearCompletedDone'))
  }

  return (
    <div className={styles.page}>
      {/* 后台生成进度提示 */}
      <LessonCostEstimate count={lessons.filter(lesson => !lesson.content).length}
        sourceTopics={lessons.filter(lesson => !lesson.content).reduce((sum, lesson) => sum + Math.max(1, bundle?.examPoints.find(point => point.id === lesson.examPointId)?.coveredPoints?.length ?? 1), 0)} />
      {(generatingLessons || canRetryGeneration) && !batchRunning && (
        <div
          className="liquid-glass fade-in"
          style={{
            borderRadius: 'var(--radius-lg)',
            padding: '14px 18px',
            marginBottom: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
              color: 'var(--text-secondary)',
            }}
          >
            {generatingLessons ? (
              <Loader
                size={16}
                strokeWidth={2}
                style={{ animation: 'spin 0.8s linear infinite' }}
              />
            ) : (
              <CircleStop size={16} strokeWidth={2} />
            )}
            <span>
              {(generatingLessons
                ? t('dashboard.genBanner')
                : t('dashboard.generationPaused'))
                  .replace('{current}', String(generationProgress.current))
                  .replace('{total}', String(generationProgress.total))}
            </span>
            <button
              type="button"
              className={styles.generationAction}
              onClick={() => {
                if (!course) return
                if (generatingLessons) cancelLessonGeneration(course.id)
                else void generateAllLessonsInBackground(course.id)
              }}
            >
              {generatingLessons ? (
                <CircleStop size={14} strokeWidth={2} />
              ) : (
                <Play size={14} strokeWidth={2.2} />
              )}
              <span>
                {generatingLessons
                  ? t('dashboard.cancelGeneration')
                  : t('progress.retryMissingLessons').replace('{count}', String(pendingGeneration.length))}
              </span>
            </button>
          </div>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{
                width: `${
                  generationProgress.total > 0
                    ? (generationProgress.current / generationProgress.total) * 100
                    : 0
                }%`,
                background: 'var(--accent-text)',
              }}
            />
          </div>
        </div>
      )}

      {/* 头部：课程名 + 进度 */}
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{course.name}</h1>
          <div className={styles.headerActions} aria-label="课程操作">
            <button
              type="button"
              className={styles.batchButton}
              disabled={optimizationActive || generatingLessons || rebuildingStructure}
            onClick={() => {
              setShowBatchConfirm(true)
              setShowRebuildConfirm(false)
              setShowClearCompletedConfirm(false)
            }}
          >
            <RefreshCw size={15} strokeWidth={2} />
            <span>{t('lessons.batchRegenerate')}</span>
            </button>
            <button
              type="button"
              className={styles.batchButton}
              disabled={optimizationActive || generatingLessons || rebuildingStructure}
            onClick={() => {
              setShowRebuildConfirm(true)
              setShowBatchConfirm(false)
              setShowClearCompletedConfirm(false)
            }}
          >
            {rebuildingStructure ? <Loader size={15} strokeWidth={2} /> : <FileText size={15} strokeWidth={2} />}
            <span>{t('lessons.rebuildStructure')}</span>
          </button>
          <button
            type="button"
            className={styles.batchButton}
            disabled={progress.completedLessons <= 0}
            onClick={() => {
              setShowClearCompletedConfirm(true)
              setShowBatchConfirm(false)
              setShowRebuildConfirm(false)
              setClearCompletedResult(null)
            }}
          >
            <CheckCircle size={15} strokeWidth={2} />
            <span>{t('lessons.clearCompleted')}</span>
          </button>
        </div>
        </div>
        <div className={styles.progressRow}>
          <div className={styles.progressInfo}>
            <span className={styles.progressCount}>
              {progress.completedLessons}/{progress.totalLessons} {t('nav.levelUnit')}
            </span>
            <span className={styles.progressPercent}>{percent}%</span>
          </div>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </header>

      {showBatchConfirm && (
        <section className={styles.batchConfirm}>
          <div className={styles.batchConfirmIcon}>
            <ShieldCheck size={20} strokeWidth={2} />
          </div>
          <div className={styles.batchConfirmCopy}>
            <strong>{t('lessons.batchConfirmTitle')}</strong>
            <span>{t('lessons.batchConfirmDesc')}</span>
          </div>
          <div className={styles.batchConfirmActions}>
            <button type="button" onClick={handleBatchRegenerate}>
              {t('lessons.batchStart')}
            </button>
            <button type="button" onClick={() => setShowBatchConfirm(false)}>
              {t('lessons.batchCancel')}
            </button>
          </div>
        </section>
      )}

      {showRebuildConfirm && (
        <section className={styles.batchConfirm}>
          <div className={styles.batchConfirmIcon}>
            <AlertCircle size={20} strokeWidth={2} />
          </div>
          <div className={styles.batchConfirmCopy}>
            <strong>{t('lessons.rebuildConfirmTitle')}</strong>
            <span>{t('lessons.rebuildConfirmDesc')}</span>
          </div>
          <div className={styles.batchConfirmActions}>
            <button type="button" onClick={handleRebuildStructure}>
              {t('lessons.rebuildStart')}
            </button>
            <button type="button" onClick={() => setShowRebuildConfirm(false)}>
              {t('lessons.batchCancel')}
            </button>
          </div>
        </section>
      )}

      {showClearCompletedConfirm && (
        <section className={styles.batchConfirm}>
          <div className={styles.batchConfirmIcon}>
            <CheckCircle size={20} strokeWidth={2} />
          </div>
          <div className={styles.batchConfirmCopy}>
            <strong>{t('lessons.clearCompletedConfirmTitle')}</strong>
            <span>{t('lessons.clearCompletedConfirmDesc')}</span>
          </div>
          <div className={styles.batchConfirmActions}>
            <button type="button" onClick={handleClearCompleted}>
              {t('lessons.clearCompletedStart')}
            </button>
            <button type="button" onClick={() => setShowClearCompletedConfirm(false)}>
              {t('lessons.batchCancel')}
            </button>
          </div>
        </section>
      )}

      {rebuildingStructure && (
        <div className={styles.batchStatus} role="status">
          <Loader size={16} strokeWidth={2} />
          <span>{t('lessons.rebuildRunning')}</span>
        </div>
      )}

      {rebuildResult && !rebuildingStructure && (
        <div className={styles.batchResult} role="status">
          <CheckCircle size={16} strokeWidth={2} />
          <span>{rebuildResult}</span>
        </div>
      )}

      {rebuildError && !rebuildingStructure && (
        <div className={styles.batchError} role="alert">
          <AlertCircle size={16} strokeWidth={2} />
          <span>{rebuildError}</span>
        </div>
      )}

      {clearCompletedResult && (
        <div className={styles.batchResult} role="status">
          <CheckCircle size={16} strokeWidth={2} />
          <span>{clearCompletedResult}</span>
        </div>
      )}

      {batchRunning && (
        <div className={styles.batchStatus} role="status">
          <Loader size={16} strokeWidth={2} />
          <span>
            {t('lessons.batchProgress')
              .replace('{current}', String(batchProgress.current))
              .replace('{total}', String(batchProgress.total))
              .replace('{title}', batchProgress.title)}
          </span>
          <button
            type="button"
            className={styles.generationAction}
            onClick={() => course && cancelCourseOptimization(course.id)}
          >
            <CircleStop size={14} strokeWidth={2} />
            <span>{t('lessons.batchCancel')}</span>
          </button>
        </div>
      )}

      {batchResult && (
        <div className={styles.batchResult} role="status">
          <CheckCircle size={16} strokeWidth={2} />
          <span>{batchResult}</span>
        </div>
      )}

      {batchCancelled && (
        <div className={styles.batchCancelled} role="status">
          <CircleStop size={16} strokeWidth={2} />
          <span>{t('lessons.batchCancelled')}</span>
        </div>
      )}

      {batchFailed && (
        <div className={styles.batchError} role="alert">
          <AlertCircle size={16} strokeWidth={2} />
          <span>{batchFailed}</span>
        </div>
      )}

      {/* 按来源课件分组的闯关路径 */}
      {lessonGroups.map(({ key: groupKey, lessons: groupLessons }) => {
        const groupDisplayTitle = getGroupDisplayTitle(groupKey, groupLessons)
        const groupSourceTooltip = getGroupSourceTooltip(groupLessons) || groupDisplayTitle
        const shouldShowGroupHeader = true
        const isCollapsed = collapsedGroups.has(groupKey)
        const completedCount = groupLessons.filter(l => l.status === 'completed').length
        const allDone = completedCount === groupLessons.length

        return (
          <div key={groupKey} className={`${styles.groupBlock} ${!shouldShowGroupHeader ? styles.singleLessonGroup : ''}`}>
            {shouldShowGroupHeader && (
              <div
                className={styles.groupHeader}
                onClick={() => toggleGroup(groupKey)}
                role="button"
                tabIndex={0}
              >
                {isCollapsed ? (
                  <ChevronRight size={16} strokeWidth={2} />
                ) : (
                  <ChevronDown size={16} strokeWidth={2} />
                )}
                <FileText size={16} strokeWidth={2} />
                <span className={styles.groupTitle} title={groupSourceTooltip}>{groupDisplayTitle}</span>
                <span className={styles.groupCount}>
                  {t('lessons.groupProgress').replace('{done}', String(completedCount)).replace('{count}', String(groupLessons.length))}
                  {allDone && <span className={styles.groupDoneTag}>{t('lessons.statusDone')}</span>}
                </span>
              </div>
            )}

            {/* 该分组的关卡列表 */}
            {(!shouldShowGroupHeader || !isCollapsed) && (
              <div className={`${styles.pathCard} liquid-glass`}>
                <div className={styles.path}>
                  {groupLessons.map((lesson, index) => {
                    const prevCompleted =
                      index > 0 && groupLessons[index - 1].status === 'completed'

                    const nodeColumn = (
                      <div className={styles.nodeColumn}>
                        {index > 0 && (
                          <div className={styles.connector}>
                            <div
                              className={`${styles.connectorLine} ${
                                prevCompleted ? styles.connectorActive : ''
                              }`}
                            />
                          </div>
                        )}
                        <div
                          className={`${styles.nodeCircle} ${styles[`node_${lesson.status === 'locked' ? 'available' : lesson.status}`]}`}
                        >
                          {lesson.status === 'completed' ? (
                            <CheckCircle size={28} strokeWidth={2.2} />
                          ) : (
                            <span className={styles.nodeNumber}>{lesson.order}</span>
                          )}
                        </div>
                      </div>
                    )

                    const lessonInfo = (
                      <div className={styles.lessonInfo}>
                        <div className={styles.lessonTitleLine}>
                          <span
                            className={`${styles.priorityTag} ${styles[`priority_${lesson.priority}`]}`}
                          >
                            {t(priorityLabelKey[lesson.priority])}
                          </span>
                          <span className={styles.lessonTitle}>{lesson.title}</span>
                        </div>
                        <div className={styles.lessonStatusGroup}>
                        {lesson.id === lastStudiedLesson?.id && (
                          <span className={styles.lastStudiedTag}>{t('progress.lastStudied')}</span>
                        )}
                        {lesson.status === 'completed' ? (
                          <div className={styles.lessonStatusDone}>{t('lessons.statusDone')}</div>
                        ) : lesson.content ? (
                          <div className={styles.lessonStatusActive}>{t('progress.lessonReady')}</div>
                        ) : (
                          <div className={styles.lessonStatusLocked}>{t('progress.lessonPending')}</div>
                        )}
                        </div>
                      </div>
                    )

                    return (
                      <button
                        key={lesson.id}
                        ref={lesson.id === lastStudiedLesson?.id ? lastStudiedRowRef : undefined}
                        type="button"
                        className={styles.lessonRow}
                        onClick={() => handleLessonClick(lesson)}
                      >
                        {nodeColumn}
                        {lessonInfo}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
