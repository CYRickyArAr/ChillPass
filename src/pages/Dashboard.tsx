import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import LessonPlanCard from '../components/common/LessonPlanCard'
import {
  Calendar,
  Flame,
  Trophy,
  ArrowRight,
  ChevronDown,
  Plus,
  Trash2,
  BookOpen,
  BookX,
  MessageCircle,
  Loader,
  Download,
  Sparkles,
  FileText,
  Check,
  X,
  Pencil,
  RefreshCw,
  Play,
  CircleStop,
} from 'lucide-react'
import { useCourseStore, useCurrentBundle } from '@stores/courseStore'
import { useAthenaPanelStore } from '@stores/athenaPanelStore'
import { extractExamPoints } from '@services/deepseek'
import { cancelLessonGeneration, generateAllLessonsInBackground } from '@services/lessonGenerator'
import { getGenerationRecovery } from '../utils/generationRecovery'
import { cleanText, parseFile } from '@services/fileParser'
import { useT } from '../i18n'
import type { TranslationKey } from '../i18n'
import { useWrongQuestionStore } from '@stores/wrongQuestionStore'
import type { Priority, CourseStatus } from '@types/index'
import styles from './Dashboard.module.css'

const statusTextKey: Record<CourseStatus, TranslationKey> = {
  empty: 'dashboard.statusEmpty',
  uploaded: 'dashboard.statusUploaded',
  analyzing: 'dashboard.statusAnalyzing',
  ready: 'dashboard.statusReady',
}

const statusColor: Record<CourseStatus, string> = {
  empty: 'var(--text-tertiary)',
  uploaded: 'var(--accent-text)',
  analyzing: 'var(--warning-text)',
  ready: 'var(--success-text)',
}

const priorityColor: Record<Priority, string> = {
  must: 'var(--danger-text)',
  high: 'var(--warning-text)',
  know: 'var(--accent-text)',
}

const preparationStepKeys: TranslationKey[] = [
  'dashboard.stageParse',
  'dashboard.stageExtract',
  'dashboard.stageBuild',
]

const DAY_IN_MS = 24 * 60 * 60 * 1000

function getCalendarDaysUntil(dateValue: string): number | null {
  const [year, month, day] = dateValue.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null

  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const examDay = Date.UTC(year, month - 1, day)
  return Math.round((examDay - today) / DAY_IN_MS)
}

export default function Dashboard() {
  const navigate = useNavigate()
  const t = useT()
  const bundle = useCurrentBundle()
  // 课程管理（切换/重命名/删除）已迁移到左侧导航栏
  const setCourseStatus = useCourseStore(s => s.setCourseStatus)
  const prepareLessonPlan = useCourseStore(s => s.prepareLessonPlan)
  const setRawText = useCourseStore(s => s.setRawText)
  const setPreparationProgress = useCourseStore(s => s.setPreparationProgress)

  const wrongQuestions = useWrongQuestionStore(s => s.questions)
  const resolveQuestion = useWrongQuestionStore(s => s.resolveQuestion)


  // 考试日期设置
  const setExamDate = useCourseStore(s => s.setExamDate)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [tempDate, setTempDate] = useState('')
  const [preparationError, setPreparationError] = useState('')

  // 倒计时：距考试还有多少天
  const daysLeft = useMemo(() => {
    if (!bundle?.course.examDate) return null
    return getCalendarDaysUntil(bundle.course.examDate)
  }, [bundle?.course.examDate])

  // 考点统计：按优先级分组
  const pointStats = useMemo(() => {
    const stats: Record<Priority, number> = { must: 0, high: 0, know: 0 }
    bundle?.examPoints.forEach(p => {
      stats[p.priority]++
    })
    return stats
  }, [bundle?.examPoints])

  // 当前课程的未解决错题
  const courseWrongQuestions = useMemo(
    () =>
      bundle
        ? wrongQuestions.filter(
            q => q.courseId === bundle.course.id && !q.resolved
          )
        : [],
    [wrongQuestions, bundle?.course.id]
  )


  /** 从保存的原文继续；若原文尚未生成，则先从已登记的课件文件恢复解析。 */
  const handleRetryPreparation = async () => {
    if (!bundle) return

    const courseId = bundle.course.id
    setPreparationError('')
    setCourseStatus(courseId, 'analyzing')
    try {
      let sourceText = bundle.rawText.trim()
      if (!sourceText || (bundle.course.files.length > 1 && !/===== 来源文件：.+? =====\r?\n/.test(sourceText))) {
        if (bundle.course.files.length === 0) throw new Error(t('upload.errFilesRequired'))
        const texts: string[] = []
        setPreparationProgress(courseId, {
          stage: 'parsing',
          current: 0,
          total: bundle.course.files.length,
        })
        for (let i = 0; i < bundle.course.files.length; i++) {
          const file = bundle.course.files[i]
          texts.push(`===== 来源文件：${file.name} =====\n${await parseFile(file.path, file.ext)}`)
          setPreparationProgress(courseId, {
            stage: 'parsing',
            current: i + 1,
            total: bundle.course.files.length,
          })
        }
        sourceText = cleanText(texts.join('\n\n'))
        if (!sourceText) throw new Error(t('upload.parseFailed'))
        setRawText(sourceText, courseId)
      }

      setPreparationProgress(courseId, { stage: 'extracting', current: 0, total: 0 })
      const points = await extractExamPoints(sourceText, bundle.course.name)
      if (points.length === 0) throw new Error(t('upload.parseFailed'))
      prepareLessonPlan(points, courseId)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('upload.parseFailed')
      setCourseStatus(courseId, 'uploaded')
      setPreparationProgress(courseId, { stage: 'error', current: 0, total: 0, error: message })
      setPreparationError(message)
    }
  }

  // ===== 状态 1：无课程 —— 欢迎引导 =====
  if (!bundle) {
    return (
      <div className={styles.container}>
        <div className={`liquid-glass ${styles.hero}`}>
          <div className={styles.heroBadge}>
            <Sparkles size={18} strokeWidth={1.8} />
            <span>{t('dashboard.badge')}</span>
          </div>
          <h1 className={styles.heroTitle}>{t('dashboard.heroTitle')}</h1>
          <p className={styles.heroSubtitle}>{t('dashboard.heroSubtitle')}</p>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className={styles.primaryBtn} onClick={() => navigate('/upload')} style={{ marginTop: 0 }}>
              <Download size={18} strokeWidth={2} />
              <span>{t('dashboard.importBtn')}</span>
            </button>
          </div>
          <div className={styles.heroSteps}>
            <div className={styles.heroStep}>
              <span className={styles.heroStepNum}>1</span>
              <span>{t('dashboard.importBtn')}</span>
            </div>
            <div className={styles.heroStep}>
              <span className={styles.heroStepNum}>2</span>
              <span>{t('dashboard.stepExtract')}</span>
            </div>
            <div className={styles.heroStep}>
              <span className={styles.heroStepNum}>3</span>
              <span>{t('dashboard.stepQuest')}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ===== 以下 bundle 一定非 null =====
  const course = bundle.course
  const progress = bundle.progress
  const examPoints = bundle.examPoints
  const preparation = bundle.preparationProgress ?? { stage: 'idle' as const, current: 0, total: 0 }
  const effectivePreparationStage =
    preparation.stage === 'parsing' ||
    preparation.stage === 'extracting' ||
    preparation.stage === 'building'
      ? preparation.stage
      : bundle.rawText.trim()
        ? 'extracting'
        : 'parsing'
  const preparationStep = effectivePreparationStage === 'parsing'
    ? 1
    : effectivePreparationStage === 'extracting'
      ? 2
      : 3
  const visiblePreparationError = preparationError || preparation.error || ''

  const progressPercent =
    progress.totalLessons > 0
      ? Math.round((progress.completedLessons / progress.totalLessons) * 100)
      : 0

  const genPercent =
    bundle.generationProgress.total > 0
      ? Math.round(
          (bundle.generationProgress.current / bundle.generationProgress.total) * 100
        )
      : 0
  const { canRetry: canRetryGeneration, pending: pendingGeneration } = getGenerationRecovery(bundle)
  const showGenerationBanner = bundle.generatingLessons || canRetryGeneration

  // 考试日期格式化与设置
  const formatExamDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return t('dashboard.dateFormat')
      .replace('{y}', String(d.getFullYear()))
      .replace('{m}', String(d.getMonth() + 1))
      .replace('{d}', String(d.getDate()))
  }

  const openDatePicker = () => {
    setTempDate(course.examDate || '')
    setShowDatePicker(true)
  }

  const confirmDate = () => {
    if (tempDate) {
      setExamDate(tempDate)
    }
    setShowDatePicker(false)
  }

  const cancelDate = () => {
    setShowDatePicker(false)
    setTempDate('')
  }

  // 课程标题（课程管理已迁移到左侧导航栏）
  const switcher = (
    <header className={styles.header}>
      <div className={styles.switcherWrap}>
        <p className={styles.greeting}>{t('dashboard.welcome')}</p>
        <h2 className={styles.courseTitle}>{course.name}</h2>
      </div>

      {progress.currentStreak > 0 && (
        <div className={`liquid-glass ${styles.streakBadge}`}>
          <Flame size={18} strokeWidth={2} />
          <span>{t('dashboard.streak').replace('{days}', String(progress.currentStreak))}</span>
        </div>
      )}
    </header>
  )

  // ===== 状态 2：课程未就绪 —— 准备中 =====
  if (bundle.lessonPlanDraft) {
    return <div className={styles.container}>{switcher}<LessonPlanCard bundle={bundle} /></div>
  }

  if (course.status !== 'ready') {
    return (
      <div className={styles.container}>
        {switcher}
        <div className={`liquid-glass ${styles.preparing}`}>
          {course.status === 'analyzing'
            ? <div className={styles.spinner} />
            : <FileText size={36} strokeWidth={1.6} className={styles.preparingIcon} />}
          <h2 className={styles.preparingTitle}>
            {course.status === 'uploaded' ? t('dashboard.preparationPaused') : t('dashboard.preparing')}
          </h2>
          <p className={styles.preparingDesc}>
            {course.status === 'empty' && t('dashboard.preparingEmpty')}
            {course.status === 'uploaded' && (
              bundle.rawText.trim()
                ? t('dashboard.preparingUploaded')
                : t('dashboard.preparingNeedsParsing')
            )}
            {course.status === 'analyzing' && effectivePreparationStage === 'parsing' && (
              preparation.total > 0
                ? t('dashboard.preparingParsingProgress')
                    .replace('{current}', String(preparation.current))
                    .replace('{total}', String(preparation.total))
                : t('dashboard.preparingParsing')
            )}
            {course.status === 'analyzing' && effectivePreparationStage === 'extracting' && t('dashboard.preparingAnalyzing')}
            {course.status === 'analyzing' && effectivePreparationStage === 'building' && (
              t('dashboard.preparingBuilding').replace('{count}', String(preparation.total))
            )}
          </p>
          {course.status !== 'empty' && (
            <div className={styles.preparationSteps} aria-label={t('dashboard.preparationProgress')}>
              {preparationStepKeys.map((key, index) => {
                const step = index + 1
                const stateClass = step < preparationStep
                  ? styles.preparationStepDone
                  : step === preparationStep
                    ? styles.preparationStepActive
                    : ''
                return (
                  <div key={key} className={`${styles.preparationStep} ${stateClass}`}>
                    <span className={styles.preparationStepNumber}>{step}</span>
                    <span>{t(key)}</span>
                  </div>
                )
              })}
            </div>
          )}
          {visiblePreparationError && <p className={styles.preparingError}>{visiblePreparationError}</p>}
          {course.status !== 'analyzing' && (
            <div className={styles.preparingActions}>
              {course.status === 'uploaded' && (Boolean(bundle.rawText.trim()) || course.files.length > 0) && (
                <button className={styles.primaryBtn} onClick={() => void handleRetryPreparation()}>
                  <RefreshCw size={18} strokeWidth={2} />
                  <span>{bundle.rawText.trim() ? t('dashboard.retryPreparation') : t('dashboard.continuePreparation')}</span>
                </button>
              )}
              <button className={styles.secondaryBtn} onClick={() => navigate('/upload')}>
                <Download size={18} strokeWidth={2} />
                <span>{course.status === 'empty' ? t('dashboard.importBtn') : t('dashboard.backToImport')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ===== 状态 3：课程就绪 —— 概览 =====
  return (
    <div className={styles.container}>
      {switcher}

      {/* 后台生成进度提示 */}
      {showGenerationBanner && (
        <div className={`liquid-glass ${styles.genBanner}`}>
          {bundle.generatingLessons ? (
            <Loader size={18} strokeWidth={2} className={styles.genSpinner} />
          ) : (
            <CircleStop size={18} strokeWidth={2} className={styles.genPausedIcon} />
          )}
          <div className={styles.genContent}>
            <div className={styles.genText}>
              {(bundle.generatingLessons
                ? t('dashboard.genBanner')
                : t('dashboard.generationPaused'))
                  .replace('{current}', String(bundle.generationProgress.current))
                  .replace('{total}', String(bundle.generationProgress.total))}
            </div>
            <div className={styles.genBar}>
              <div
                className={styles.genFill}
                style={{ width: `${genPercent}%` }}
              />
            </div>
          </div>
          {bundle.generatingLessons ? (
            <button
              type="button"
              className={styles.genAction}
              onClick={() => cancelLessonGeneration(course.id)}
            >
              <CircleStop size={15} strokeWidth={2} />
              <span>{t('dashboard.cancelGeneration')}</span>
            </button>
          ) : (
            <button
              type="button"
              className={styles.genActionPrimary}
              onClick={() => void generateAllLessonsInBackground(course.id)}
            >
              <Play size={15} strokeWidth={2.2} />
              <span>{t('progress.retryMissingLessons').replace('{count}', String(pendingGeneration.length))}</span>
            </button>
          )}
        </div>
      )}

      <div className={styles.grid}>
        {/* 倒计时卡片 */}
        <div className={`liquid-glass ${styles.card} ${styles.countdownCard}`}>
          <div className={styles.cardIcon}>
            <Calendar size={20} strokeWidth={1.8} />
          </div>
          <div className={styles.cardLabel}>
            {daysLeft !== null && daysLeft < 0
              ? t('dashboard.examDateLabel')
              : t('dashboard.untilExam')}
          </div>

          {/* 修改按钮 —— 已设置日期且未展开选择器时显示在右上角 */}
          {daysLeft !== null && !showDatePicker && (
            <button
              onClick={openDatePicker}
              title={t('dashboard.editDate')}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-tertiary)',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                transition: 'color 0.2s ease',
                zIndex: 3,
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-text)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
            >
              {t('dashboard.edit')}
            </button>
          )}

          {showDatePicker ? (
            /* 日期选择器 —— 内联展开 */
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                marginTop: '4px',
              }}
            >
              <input
                type="date"
                value={tempDate}
                onChange={e => setTempDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'rgba(0, 0, 0, 0.03)',
                  border: '1px solid rgba(0, 0, 0, 0.1)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '15px',
                  fontFamily: 'inherit',
                  colorScheme: 'light',
                  outline: 'none',
                  transition: 'border-color 0.2s ease',
                }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={confirmDate}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    padding: '8px 12px',
                    background: 'var(--accent-text)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: '#fff',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'opacity 0.2s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                  <Check size={14} strokeWidth={2.4} />
                  {t('common.confirm')}
                </button>
                <button
                  onClick={cancelDate}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    padding: '8px 12px',
                    background: 'rgba(0, 0, 0, 0.04)',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-secondary)',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.2s ease',
                  }}
                  onMouseEnter={e =>
                    (e.currentTarget.style.background = 'rgba(0, 0, 0, 0.07)')
                  }
                  onMouseLeave={e =>
                    (e.currentTarget.style.background = 'rgba(0, 0, 0, 0.04)')
                  }
                >
                  <X size={14} strokeWidth={2.4} />
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : daysLeft === null ? (
            /* 未设置日期 —— 点击设置 */
            <button
              onClick={openDatePicker}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-tertiary)',
                fontSize: '16px',
                cursor: 'pointer',
                padding: '10px 0',
                marginTop: '4px',
                transition: 'color 0.2s ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-text)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
            >
              <Calendar size={18} strokeWidth={1.8} />
              <span>{t('dashboard.setExamDate')}</span>
            </button>
          ) : (
            /* 已设置日期 —— 显示倒计时 */
            <>
              {daysLeft < 0 ? (
                <div className={styles.countdownEnded}>
                  {t('dashboard.examEnded')}
                </div>
              ) : (
                <div
                  className={styles.countdownNum}
                  style={
                    daysLeft > 0 && daysLeft <= 7
                      ? { color: 'var(--danger-text)' }
                      : undefined
                  }
                >
                  {daysLeft}
                  <span className={styles.countdownUnit}>{t('dashboard.dayUnit')}</span>
                </div>
              )}
              <div
                style={{
                  fontSize: '14px',
                  color: 'var(--text-secondary)',
                  marginTop: '-4px',
                }}
              >
                {formatExamDate(course.examDate!)}
              </div>
              {daysLeft > 0 && daysLeft <= 7 && (
                <div
                  className={styles.countdownHint}
                  style={{ color: 'var(--danger-text)' }}
                >
                  {t('dashboard.sprintFinal')}
                </div>
              )}
              {daysLeft === 0 && (
                <div
                  className={styles.countdownHint}
                  style={{ color: 'var(--success-text)' }}
                >
                  {t('dashboard.examToday')}
                </div>
              )}
              {daysLeft < 0 && (
                <div
                  className={styles.countdownHint}
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {t('dashboard.examEndedDays').replace(
                    '{days}',
                    String(Math.abs(daysLeft))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* 进度卡片 */}
        <div className={`liquid-glass ${styles.card}`}>
          <div className={styles.cardIcon}>
            <Trophy size={20} strokeWidth={1.8} />
          </div>
          <div className={styles.cardLabel}>{t('dashboard.progress')}</div>
          <div className={styles.progressNum}>
            {progress.completedLessons}
            <span className={styles.progressTotal}>/{progress.totalLessons} {t('nav.levelUnit')}</span>
          </div>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className={styles.progressMeta}>
            <span className={styles.progressPercent}>{progressPercent}%</span>
          </div>
        </div>

        {/* 考点统计卡片 */}
        <div className={`liquid-glass ${styles.card}`}>
          <div className={styles.cardIcon}>
            <FileText size={20} strokeWidth={1.8} />
          </div>
          <div className={styles.cardLabel}>{t('dashboard.examStats')}</div>
          <div className={styles.pointStats}>
            <div className={styles.pointItem}>
              <span className={styles.pointNum} style={{ color: 'var(--danger-text)' }}>
                {pointStats.must}
              </span>
              <span className={styles.pointName}>{t('dashboard.priorityMust')}</span>
            </div>
            <div className={styles.pointItem}>
              <span className={styles.pointNum} style={{ color: 'var(--warning-text)' }}>
                {pointStats.high}
              </span>
              <span className={styles.pointName}>{t('dashboard.priorityHigh')}</span>
            </div>
            <div className={styles.pointItem}>
              <span className={styles.pointNum} style={{ color: 'var(--accent-text)' }}>
                {pointStats.know}
              </span>
              <span className={styles.pointName}>{t('dashboard.priorityKnow')}</span>
            </div>
          </div>
          <div className={styles.pointTotal}>{t('dashboard.totalPoints').replace('{count}', String(examPoints.length))}</div>
        </div>

        {/* 快捷入口卡片 */}
        <div className={`liquid-glass ${styles.card}`}>
          <div className={styles.cardIcon}>
            <Sparkles size={20} strokeWidth={1.8} />
          </div>
          <div className={styles.cardLabel}>{t('dashboard.quickEntries')}</div>
          <div className={styles.quickActions}>
            <button
              className={styles.quickBtn}
              onClick={() => {
                navigate('/lessons')
              }}
            >
              <BookOpen size={18} strokeWidth={1.8} />
              <span className={styles.quickBtnText}>{t('dashboard.continueStudy')}</span>
              <ArrowRight size={16} strokeWidth={2} />
            </button>
            <button
              className={styles.quickBtnGhost}
              onClick={() => useAthenaPanelStore.getState().open()}
            >
              <MessageCircle size={18} strokeWidth={1.8} />
              <span className={styles.quickBtnText}>{t('dashboard.quickAsk')}</span>
              <ArrowRight size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
