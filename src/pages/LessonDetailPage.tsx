import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReadyLessonNotice from '../components/common/ReadyLessonNotice'
import {
  ArrowLeft,
  Lightbulb,
  PenTool,
  HelpCircle,
  Check,
  X,
  LoaderCircle,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  SkipForward,
  Sparkles,
  ChevronDown,
  History,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useCourseStore, useCurrentBundle } from '@stores/courseStore'
import {
  beginQuizQuestionRequest,
  createEmptyQuizAttempt,
  invalidateQuizLessonRequests,
  invalidateQuizQuestionRequests,
  isQuizQuestionRequestCurrent,
  makeQuizQuestionRefs,
  quizProgressKey,
  useQuizProgressStore,
  type QuizContentTab,
  type QuizQuestionProgress,
  type StoredQuizReview,
} from '@stores/quizProgressStore'
import { useWrongQuestionStore } from '@stores/wrongQuestionStore'
import {
  adjudicateAnswer,
  adjudicateTextAnswer,
  gradeAnswer,
  regenerateQuizQuestion,
} from '@services/deepseek'
import { cancelCourseOptimization, startSingleLessonOptimization } from '@services/courseOptimizer'
import type { Priority, QuizQuestion, QuizType } from '@types/index'
import { renderMarkdown, renderInlineMarkdown } from '../utils/markdown'
import { playClickSound, playCorrectSound } from '@services/sound'
import { useT } from '../i18n'
import type { TranslationKey } from '../i18n'
import styles from './LessonDetailPage.module.css'

const priorityLabel: Record<Priority, TranslationKey> = {
  must: 'dashboard.priorityMust',
  high: 'dashboard.priorityHigh',
  know: 'dashboard.priorityKnow',
}

/** 去除选项文本中已有的 A. B. C. D. 前缀，避免重复 */
function cleanOptionText(opt: string): string {
  if (!opt) return ''
  return opt.replace(/^[A-Z][.、．)]\s*/i, '').trim()
}

/** 使用题目现有答案，不生成新内容，也不把选项字母当作题目正文。 */
function referenceAnswers(q: QuizQuestion): string[] {
  const type = q.type || 'choice'
  if (type === 'choice' || type === 'multi') {
    const indices = type === 'multi' ? q.correctIndices ?? [] : [q.correctIndex]
    return [...new Set(indices)]
      .filter((index): index is number => typeof index === 'number' && Number.isInteger(index) &&
        index >= 0 && index < (q.options?.length ?? 0))
      .sort((a, b) => a - b)
      .map(index => `${String.fromCharCode(65 + index)}. ${cleanOptionText(q.options![index])}`)
  }
  const answer = q.answer?.trim() || q.acceptableAnswers?.find(item => item.trim())?.trim()
  return answer ? [answer] : []
}

/** 打乱选择题选项顺序，返回新 correctIndex/correctIndices */
function shuffleOptions(q: QuizQuestion): QuizQuestion {
  if (!q.options) return q

  // 多选题
  if (q.type === 'multi' && q.correctIndices) {
    const correctOptions = q.correctIndices.map(i => q.options![i])
    const shuffled = [...q.options].sort(() => Math.random() - 0.5)
    const newCorrectIndices = correctOptions.map(opt => shuffled.indexOf(opt)).filter(i => i >= 0)
    return { ...q, options: shuffled, correctIndices: newCorrectIndices }
  }

  // 单选题
  if (q.correctIndex !== undefined) {
    const correctOption = q.options[q.correctIndex]
    const shuffled = [...q.options].sort(() => Math.random() - 0.5)
    const newCorrectIndex = shuffled.indexOf(correctOption)
    return { ...q, options: shuffled, correctIndex: newCorrectIndex }
  }

  return q
}

type Tab = QuizContentTab

const EMPTY_QUIZ_QUESTIONS: QuizQuestion[] = []
const EMPTY_QUIZ_ATTEMPT = createEmptyQuizAttempt()

export default function LessonDetailPage() {
  const t = useT()
  const { lessonId } = useParams<{ lessonId: string }>()
  const navigate = useNavigate()

  const bundle = useCurrentBundle()
  const lessons = bundle?.lessons ?? []
  const examPoints = bundle?.examPoints ?? []
  const rawText = bundle?.rawText ?? ''
  const generatingLessons = bundle?.generatingLessons ?? false

  const completeLesson = useCourseStore(s => s.completeLesson)
  const setLessonContent = useCourseStore(s => s.setLessonContent)
  const restorePreviousLessonContent = useCourseStore(s => s.restorePreviousLessonContent)
  const addWrongQuestion = useWrongQuestionStore(s => s.addWrongQuestion)
  const removeQuestion = useWrongQuestionStore(s => s.removeQuestion)

  const lesson = lessons.find(l => l.id === lessonId)
  const content = lesson?.content ?? null
  const assessmentForQuestion = (question: QuizQuestion) => ({
    questionType: question.type,
    discipline: content?.learningDesign?.discipline,
    objective: question.objective,
    taskKind: question.taskKind,
    gradingCriteria: question.gradingCriteria,
  })
  const courseId = bundle?.course.id ?? ''
  const rememberStudiedLesson = useCourseStore(s => s.rememberStudiedLesson)
  useEffect(() => {
    if (courseId && lessonId && content) rememberStudiedLesson(courseId, lessonId)
  }, [courseId, lessonId, content, rememberStudiedLesson])
  const quizQuestions = content?.quiz ?? EMPTY_QUIZ_QUESTIONS
  const questionRefs = useMemo(
    () => makeQuizQuestionRefs(lessonId ?? '', quizQuestions),
    [lessonId, quizQuestions],
  )
  const progressKey = courseId && lessonId ? quizProgressKey(courseId, lessonId) : ''
  const quizProgress = useQuizProgressStore(state =>
    progressKey ? state.byLesson[progressKey] : undefined,
  )
  const syncQuizProgress = useQuizProgressStore(state => state.syncLesson)
  const setProgressTab = useQuizProgressStore(state => state.setActiveTab)
  const setProgressQuestion = useQuizProgressStore(state => state.setCurrentQuestion)
  const patchProgressAttempt = useQuizProgressStore(state => state.patchAttempt)
  const resetProgressAttempt = useQuizProgressStore(state => state.resetAttempt)
  const restoreArchivedLessonProgress = useQuizProgressStore(state => state.restoreArchivedLesson)

  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false)
  const [contentNotice, setContentNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [grading, setGrading] = useState(false)
  const [reviewingQuestionId, setReviewingQuestionId] = useState<string | null>(null)
  const selectionPointerStart = useRef<{ x: number; y: number } | null>(null)
  const currentOptimizationJob = bundle?.optimizationJob
  const optimizationActive = currentOptimizationJob?.status === 'running' ||
    currentOptimizationJob?.status === 'paused'
  const lessonOptimizationItem = lessonId ? currentOptimizationJob?.items[lessonId] : undefined
  const lessonMutationLocked = Boolean(
    optimizationActive &&
    lessonOptimizationItem &&
    (lessonOptimizationItem.state === 'pending' || lessonOptimizationItem.state === 'processing'),
  )
  const lessonOptimizationJob = currentOptimizationJob?.kind === 'single' &&
    lessonId && currentOptimizationJob.targetLessonIds.includes(lessonId)
    ? currentOptimizationJob
    : undefined
  const regenerating = lessonOptimizationJob?.status === 'running' || Boolean(
    currentOptimizationJob?.kind === 'batch' &&
    currentOptimizationJob.status === 'running' &&
    lessonOptimizationItem?.state === 'processing',
  )
  const optimizedSuccessfully = lessonOptimizationJob?.status === 'completed' &&
    lessonOptimizationJob.summary?.success === 1
  const optimizationCancelled = lessonOptimizationJob?.status === 'cancelled'
  const optimizationError = lessonOptimizationJob?.error ??
    (lessonId ? lessonOptimizationJob?.items[lessonId]?.error : undefined)
  const courseOptimizationBusy = optimizationActive || bundle?.generatingLessons === true

  useEffect(() => {
    if (!lessonMutationLocked) return
    // 关卡即将被整体替换，本页旧题的瞬时加载态也必须立即结束。
    setGrading(false)
    setReviewingQuestionId(null)
  }, [lessonMutationLocked, lessonId])

  // 题目内容加载或发生变化时，仅按稳定题目 id 对齐进度；不会用默认空状态覆盖旧进度。
  useEffect(() => {
    if (!courseId || !lessonId || !content) return
    syncQuizProgress(courseId, lessonId, questionRefs)
  }, [content, courseId, lessonId, questionRefs, syncQuizProgress])

  const tab: Tab = quizProgress?.activeTab ?? 'points'
  const storedQuestionIndex = quizProgress?.currentQuestionId
    ? questionRefs.findIndex(ref => ref.id === quizProgress.currentQuestionId)
    : -1
  const quizPage = storedQuestionIndex >= 0 ? storedQuestionIndex : 0
  const currentQuestionId = questionRefs[quizPage]?.id ?? null
  const currentAttempt = currentQuestionId
    ? quizProgress?.attempts[currentQuestionId] ?? EMPTY_QUIZ_ATTEMPT
    : EMPTY_QUIZ_ATTEMPT
  const choiceSelected = currentAttempt.choiceSelected
  const multiSelected = new Set(currentAttempt.multiSelected)
  const multiSubmitted = currentAttempt.multiSubmitted
  const textAnswer = currentAttempt.textAnswer
  const feedback = currentAttempt.feedback
  const answerVisible = currentAttempt.answerVisible === true
  const revealed = currentAttempt.revealed
  const review =
    reviewingQuestionId === currentQuestionId
      ? ({ state: 'running', text: '', collapsed: false } as const)
      : currentAttempt.review
  const reviewInFlight = reviewingQuestionId !== null
  const pageSolved = new Set(
    questionRefs.flatMap((ref, index) =>
      quizProgress?.attempts[ref.id]?.solved ? [index] : [],
    ),
  )

  // 关卡不存在
  if (!lesson) {
    return (
      <div className={styles.page}>
        <div className={`${styles.notFound} liquid-glass`}>
          <p className={styles.notFoundText}>{t('lesson.notFound')}</p>
          <button
            className={styles.backButton}
            onClick={() => navigate('/lessons')}
          >
            <ArrowLeft size={16} strokeWidth={2} />
            <span>{t('lesson.backToList')}</span>
          </button>
        </div>
      </div>
    )
  }

  const examPoint = examPoints.find(p => p.id === lesson.examPointId)
  const isCompleted = lesson.status === 'completed'

  const patchAttempt = (
    questionId: string,
    patch: Partial<QuizQuestionProgress>,
    refs = questionRefs,
  ) => {
    if (!courseId) return
    patchProgressAttempt(courseId, lesson.id, refs, questionId, patch)
  }

  const isQuestionVersionCurrent = (questionId: string, fingerprint: string) =>
    useQuizProgressStore
      .getState()
      .byLesson[progressKey]?.questionRefs.some(
        ref => ref.id === questionId && ref.fingerprint === fingerprint,
      ) === true

  const handleTabChange = (nextTab: Tab) => {
    if (!courseId) return
    setProgressTab(courseId, lesson.id, questionRefs, nextTab)
  }

  const goToQuizPage = (pageIndex: number, refs = questionRefs) => {
    const targetId = refs[pageIndex]?.id
    if (!courseId || !targetId) return
    setProgressQuestion(courseId, lesson.id, refs, targetId)
  }

  /** 手动重新生成关卡内容 */
  const handleRegenerate = () => {
    if (courseOptimizationBusy || grading || reviewInFlight) return
    if (!examPoint) {
      setError(t('lesson.noExamPoint'))
      return
    }
    setConfirmingRegenerate(false)
    setContentNotice(null)
    setError(null)
    if (courseId) startSingleLessonOptimization(courseId, lesson.id)
  }

  const handleComplete = () => {
    if (lessonMutationLocked) return
    completeLesson(lesson.id)
    navigate('/lessons')
  }

  /** 多选题：切换选项选择 */
  const handleMultiToggle = (optionIndex: number) => {
    if (lessonMutationLocked || multiSubmitted || !currentQuestionId) return
    playClickSound()
    // 从 store 读取最新值，避免用户快速连点时第二次点击覆盖第一次选择。
    const latestSelection = useQuizProgressStore.getState().byLesson[progressKey]
      ?.attempts[currentQuestionId]?.multiSelected ?? currentAttempt.multiSelected
    const next = new Set(latestSelection)
    if (next.has(optionIndex)) {
      next.delete(optionIndex)
    } else {
      next.add(optionIndex)
    }
    patchAttempt(currentQuestionId, { multiSelected: [...next] })
  }

  const handleRestorePrevious = () => {
    if (!courseId || courseOptimizationBusy || grading || reviewInFlight) return
    invalidateQuizLessonRequests(courseId, lesson.id)
    const restored = restorePreviousLessonContent(lesson.id, courseId)
    if (!restored) return
    restoreArchivedLessonProgress(courseId, lesson.id)
    setConfirmingRegenerate(false)
    setError(null)
    setContentNotice(t('lesson.restoreSuccess'))
  }

  /**
   * 把（复核修正、重试打乱或重新生成的）小测题写回课程存储。
   * 按下标替换而非按 id：重新生成的题目是全新 id，在存储中匹配不到 id
   * 返回新的题目引用，供答题进度在同一事件中同步对齐。
   */
  const patchQuizQuestion = (patched: QuizQuestion, index = quizPage) => {
    if (!content) return questionRefs
    const nextQuiz = quizQuestions.map((item, i) => (i === index ? patched : item))
    setLessonContent(lesson.id, { ...content, quiz: nextQuiz })
    return makeQuizQuestionRefs(lesson.id, nextQuiz)
  }

  /** 记录错题并保存 id，便于复核改判后撤回 */
  const recordWrongQuestion = (q: QuizQuestion, selectedIndex?: number, selectedIndices?: number[]) => {
    if (!examPoint || !bundle) return
    return addWrongQuestion({
      courseId: bundle.course.id,
      courseName: bundle.course.name,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      question: q.question,
      quizType: q.type,
      options: q.options,
      correctIndex: q.correctIndex,
      correctIndices: q.correctIndices,
      selectedIndex,
      selectedIndices,
      explanation: q.explanation,
      examPointTitle: examPoint.title,
      priority: lesson.priority,
    })
  }

  /** 用户主动复核：独立裁定本题参考答案是否正确、用户是否其实答对 */
  const handleReview = async () => {
    const q = quizQuestions[quizPage]
    const questionRef = questionRefs[quizPage]
    const questionId = questionRef?.id
    if (lessonMutationLocked || !q || !questionId || !questionRef || review?.state === 'running') return
    // 填空/简答按文本答案复核；选择/多选按选项复核
    if (q.type === 'fill' || q.type === 'short') {
      await handleReviewTextAnswer(q, questionId)
      return
    }
    if (!q.options) return

    const requestId = beginQuizQuestionRequest(courseId, lesson.id, questionId)
    setReviewingQuestionId(questionId)
    try {
      const result = await adjudicateAnswer({
        questionType: q.type === 'multi' ? 'multi' : 'choice',
        question: q.question,
        options: q.options,
        storedCorrectIndex: q.correctIndex,
        storedCorrectIndices: q.correctIndices,
        userSelectedIndex: choiceSelected ?? undefined,
        userSelectedIndices: q.type === 'multi' ? [...multiSelected] : undefined,
      })
      if (
        !isQuizQuestionRequestCurrent(courseId, lesson.id, questionId, requestId) ||
        !isQuestionVersionCurrent(questionId, questionRef.fingerprint)
      ) return

      // 复核给出新的正确答案时，修正题目答案（本地 + 课程存储）
      const patched: QuizQuestion = { ...q }
      if (q.type === 'multi' && result.correctIndices) {
        patched.correctIndices = result.correctIndices
      } else if (q.type !== 'multi' && result.correctIndex !== undefined) {
        patched.correctIndex = result.correctIndex
      }
      const hasCorrection =
        q.type === 'multi' ? !!result.correctIndices : result.correctIndex !== undefined
      const nextRefs = hasCorrection ? patchQuizQuestion(patched) : questionRefs
      const storedReview: StoredQuizReview = {
        state: 'done',
        userCorrect: result.userCorrect,
        text: hasCorrection && result.userCorrect ? `${t('lesson.keyFixedNote')}

${result.feedback}` : result.feedback,
        collapsed: false,
      }

      if (result.userCorrect) {
        // 复核确认用户答对：改判正确、撤回错题记录、播放正确音
        const wrongId = useQuizProgressStore.getState().byLesson[progressKey]?.attempts[questionId]
          ?.wrongEntryId
        if (wrongId) {
          removeQuestion(wrongId)
        }
        patchAttempt(
          questionId,
          { review: storedReview, solved: true, wrongEntryId: undefined },
          nextRefs,
        )
        playCorrectSound()
      } else {
        patchAttempt(questionId, { review: storedReview }, nextRefs)
      }
    } catch (err) {
      if (
        isQuizQuestionRequestCurrent(courseId, lesson.id, questionId, requestId) &&
        isQuestionVersionCurrent(questionId, questionRef.fingerprint)
      ) {
        patchAttempt(questionId, {
          review: {
            state: 'error',
            text: err instanceof Error ? err.message : t('common.unknownError'),
            collapsed: false,
          },
        })
      }
    } finally {
      if (isQuizQuestionRequestCurrent(courseId, lesson.id, questionId, requestId)) {
        setReviewingQuestionId(current => (current === questionId ? null : current))
      }
    }
  }

  /**
   * 填空/简答复核
   * 系统判分使用 gradeAnswer，可能漏判合理表述或参考答案本身有误，
   * 用户有疑问时由此再独立复判一次，必要时修正参考答案
   */
  const handleReviewTextAnswer = async (q: QuizQuestion, questionId: string) => {
    if (lessonMutationLocked) return
    const questionRef = questionRefs.find(ref => ref.id === questionId)
    if (!questionRef) return
    const answerToReview = textAnswer
    const requestId = beginQuizQuestionRequest(courseId, lesson.id, questionId)
    setReviewingQuestionId(questionId)
    try {
      const result = await adjudicateTextAnswer({
        question: q.question,
        userAnswer: answerToReview,
        referenceAnswer: q.answer ?? '',
        acceptableAnswers: q.acceptableAnswers,
        explanation: q.explanation,
        assessment: assessmentForQuestion(q),
      })
      if (
        !isQuizQuestionRequestCurrent(courseId, lesson.id, questionId, requestId) ||
        !isQuestionVersionCurrent(questionId, questionRef.fingerprint)
      ) return

      // 复核给出更准确的参考答案时同步修正题目（本地 + 课程存储）
      const needsAnswerFix = !!result.correctedAnswer
      const needsAcceptFix =
        !!result.additionalAcceptableAnswers && result.additionalAcceptableAnswers.length > 0
      let nextRefs = questionRefs
      if (needsAnswerFix || needsAcceptFix) {
        nextRefs = patchQuizQuestion({
          ...q,
          ...(needsAnswerFix ? { answer: result.correctedAnswer } : {}),
          ...(needsAcceptFix
            ? {
                acceptableAnswers: Array.from(
                  new Set([...(q.acceptableAnswers ?? []), ...result.additionalAcceptableAnswers!]),
                ),
              }
            : {}),
        })
      }

      const storedReview: StoredQuizReview = {
        state: 'done',
        userCorrect: result.userCorrect,
        text:
          needsAnswerFix && result.userCorrect
            ? `${t('lesson.keyFixedNote')}

${result.feedback}`
            : result.feedback,
        collapsed: false,
      }

      if (result.userCorrect) {
        const wrongId = useQuizProgressStore.getState().byLesson[progressKey]?.attempts[questionId]
          ?.wrongEntryId
        if (wrongId) {
          removeQuestion(wrongId)
        }
        patchAttempt(
          questionId,
          {
            feedback: { correct: true, status: 'correct', text: result.feedback },
            review: storedReview,
            solved: true,
            wrongEntryId: undefined,
          },
          nextRefs,
        )
        playCorrectSound()
      } else {
        patchAttempt(questionId, { review: storedReview }, nextRefs)
      }
    } catch (err) {
      if (
        isQuizQuestionRequestCurrent(courseId, lesson.id, questionId, requestId) &&
        isQuestionVersionCurrent(questionId, questionRef.fingerprint)
      ) {
        patchAttempt(questionId, {
          review: {
            state: 'error',
            text: err instanceof Error ? err.message : t('common.unknownError'),
            collapsed: false,
          },
        })
      }
    } finally {
      if (isQuizQuestionRequestCurrent(courseId, lesson.id, questionId, requestId)) {
        setReviewingQuestionId(current => (current === questionId ? null : current))
      }
    }
  }

  /** 多选题：提交答案 */
  const handleMultiSubmit = () => {
    const q = quizQuestions[quizPage]
    const questionId = questionRefs[quizPage]?.id
    if (lessonMutationLocked || !q || !questionId || !q.correctIndices || multiSelected.size === 0) return

    const correctSet = new Set(q.correctIndices)
    const isCorrect =
      multiSelected.size === correctSet.size &&
      [...multiSelected].every(i => correctSet.has(i))
    const wrongEntryId = isCorrect
      ? undefined
      : recordWrongQuestion(q, undefined, [...multiSelected])

    invalidateQuizQuestionRequests(courseId, lesson.id, questionId)
    patchAttempt(questionId, {
      multiSelected: [...multiSelected],
      multiSubmitted: true,
      solved: isCorrect || currentAttempt.solved,
      review: null,
      ...(wrongEntryId ? { wrongEntryId } : {}),
    })

    if (isCorrect) {
      playCorrectSound()
    }
  }

  /** 多选题：再试一次（打乱选项） */
  const handleRetryMulti = () => {
    const q = quizQuestions[quizPage]
    const questionId = questionRefs[quizPage]?.id
    if (lessonMutationLocked || !q || !questionId || !courseId || reviewInFlight) return
    invalidateQuizQuestionRequests(courseId, lesson.id, questionId)
    const shuffled = shuffleOptions(q)
    const nextRefs = patchQuizQuestion(shuffled)
    resetProgressAttempt(courseId, lesson.id, nextRefs, questionId, true)
    setReviewingQuestionId(current => (current === questionId ? null : current))
  }

  /** 选择题：点击选项 */
  const handleChoiceAnswer = (optionIndex: number) => {
    if (lessonMutationLocked || revealed) return
    const q = quizQuestions[quizPage]
    const questionId = questionRefs[quizPage]?.id
    if (!q || !questionId || q.correctIndex === undefined) return

    playClickSound()
    const isCorrect = optionIndex === q.correctIndex
    const wrongEntryId = isCorrect ? undefined : recordWrongQuestion(q, optionIndex)
    invalidateQuizQuestionRequests(courseId, lesson.id, questionId)
    patchAttempt(questionId, {
      choiceSelected: optionIndex,
      revealed: true,
      solved: isCorrect || currentAttempt.solved,
      review: null,
      ...(wrongEntryId ? { wrongEntryId } : {}),
    })

    if (isCorrect) {
      playCorrectSound()
    }
  }

  /** 选择题：再试一次（打乱选项） */
  const handleRetryChoice = () => {
    const q = quizQuestions[quizPage]
    const questionId = questionRefs[quizPage]?.id
    if (lessonMutationLocked || !q || !questionId || !courseId || reviewInFlight) return
    invalidateQuizQuestionRequests(courseId, lesson.id, questionId)
    const shuffled = shuffleOptions(q)
    const nextRefs = patchQuizQuestion(shuffled)
    resetProgressAttempt(courseId, lesson.id, nextRefs, questionId, true)
    setReviewingQuestionId(current => (current === questionId ? null : current))
  }

  /** 填空/简答题：提交答案 */
  const handleSubmitText = async () => {
    const q = quizQuestions[quizPage]
    const questionRef = questionRefs[quizPage]
    const questionId = questionRef?.id
    const submittedAnswer = textAnswer
    if (lessonMutationLocked || !q || !questionId || !questionRef || !submittedAnswer.trim() || grading) return

    const requestId = beginQuizQuestionRequest(courseId, lesson.id, questionId)
    setGrading(true)
    try {
      const result = await gradeAnswer(
        q.question,
        submittedAnswer,
        q.answer || '',
        q.acceptableAnswers || [],
        assessmentForQuestion(q),
      )
      if (
        !isQuizQuestionRequestCurrent(courseId, lesson.id, questionId, requestId) ||
        !isQuestionVersionCurrent(questionId, questionRef.fingerprint)
      ) return

      const latestAttempt = useQuizProgressStore.getState().byLesson[progressKey]
        ?.attempts[questionId]
      let wrongEntryId: string | null | undefined
      if (result.correct) {
        if (latestAttempt?.wrongEntryId) removeQuestion(latestAttempt.wrongEntryId)
        playCorrectSound()
      } else if (result.status === 'incorrect' && !latestAttempt?.wrongEntryId && examPoint && bundle) {
        wrongEntryId = addWrongQuestion({
          courseId: bundle.course.id,
          courseName: bundle.course.name,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          question: q.question,
          quizType: q.type,
          userAnswer: submittedAnswer,
          correctAnswer: q.answer,
          explanation: q.explanation,
          examPointTitle: examPoint.title,
          priority: lesson.priority,
        })
      }
      patchAttempt(questionId, {
        textAnswer: submittedAnswer,
        feedback: { correct: result.correct, status: result.status, text: result.feedback },
        solved: result.correct || latestAttempt?.solved === true,
        review: null,
        ...(result.correct ? { wrongEntryId: undefined } : {}),
        ...(wrongEntryId ? { wrongEntryId } : {}),
      })
    } catch {
      if (
        isQuizQuestionRequestCurrent(courseId, lesson.id, questionId, requestId) &&
        isQuestionVersionCurrent(questionId, questionRef.fingerprint)
      ) {
        patchAttempt(questionId, {
          textAnswer: submittedAnswer,
          feedback: { correct: false, status: 'unavailable', text: t('lesson.gradeFailed') },
        })
      }
    } finally {
      setGrading(false)
    }
  }

  /** 重新生成当前题（保持同一知识点） */
  const handleRegenerateQuestion = async () => {
    const q = quizQuestions[quizPage]
    const questionRef = questionRefs[quizPage]
    const questionId = questionRef?.id
    if (lessonMutationLocked || !q || !questionId || !questionRef || !examPoint || reviewInFlight || grading) return

    const requestId = beginQuizQuestionRequest(courseId, lesson.id, questionId)
    setGrading(true)
    try {
      // 新题与原题题型、知识点保持一致（服务层强校验，不一致会自动重试）
      const newQ = await regenerateQuizQuestion(
        q.examPointTitle || examPoint.title,
        q.question,
        q.type,
        rawText,
        q.id,
        q.explanation,
        { courseName: bundle?.course.name, examPoint, learningDesign: content?.learningDesign, assessment: assessmentForQuestion(q) },
      )
      if (
        !isQuizQuestionRequestCurrent(courseId, lesson.id, questionId, requestId) ||
        !isQuestionVersionCurrent(questionId, questionRef.fingerprint)
      ) return

      // 同时更新界面状态与课程存储，避免离开页面后新题丢失
      const nextRefs = patchQuizQuestion(newQ)
      const nextQuestionId = nextRefs[quizPage]?.id
      if (courseId && nextQuestionId) {
        resetProgressAttempt(courseId, lesson.id, nextRefs, nextQuestionId, false)
      }
      setReviewingQuestionId(current => (current === questionId ? null : current))
    } catch {
      if (
        isQuizQuestionRequestCurrent(courseId, lesson.id, questionId, requestId) &&
        isQuestionVersionCurrent(questionId, questionRef.fingerprint)
      ) {
        patchAttempt(questionId, {
          feedback: { correct: false, status: 'unavailable', text: t('lesson.regenerateFailed') },
        })
      }
    } finally {
      setGrading(false)
    }
  }

  /** 只展开已有参考答案，不触发 AI、判分、错题记录或通关。 */
  const handleToggleAnswer = () => {
    if (lessonMutationLocked || !currentQuestionId || grading || reviewInFlight) return
    const latest = useQuizProgressStore.getState().byLesson[progressKey]?.attempts[currentQuestionId]
    patchAttempt(currentQuestionId, { answerVisible: !latest?.answerVisible })
  }

  /** 免费跳过当前题，直接进入下一题。 */
  const handleSkipQuestion = () => {
    if (lessonMutationLocked || !currentQuestionId || currentAttempt.solved || reviewInFlight) return
    setError(null)
    invalidateQuizQuestionRequests(courseId, lesson.id, currentQuestionId)
    // 立即持久化跳过状态，离开页面后不会丢进度。
    patchAttempt(currentQuestionId, { solved: true, skipped: true })
    // 如果不是最后一题，进入下一题
    if (quizPage < quizQuestions.length - 1) {
      goToQuizPage(quizPage + 1)
    }
  }

  /** 下一题 */
  const handleNextPage = () => {
    if (quizPage < quizQuestions.length - 1) {
      goToQuizPage(quizPage + 1)
    }
  }

  /** 跳转到已完成的题目 */
  const handleNavigateToPage = (pageIndex: number) => {
    if (pageSolved.has(pageIndex)) {
      goToQuizPage(pageIndex)
    }
  }

  const handleSelectionPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    selectionPointerStart.current = { x: event.clientX, y: event.clientY }
  }

  const handleSelectionClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const start = selectionPointerStart.current
    selectionPointerStart.current = null
    if (!start || event.detail > 1) return

    // 拖动是在框选文字；只有短按才清除之前残留的蓝色选区。
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (moved > 4) return

    const target = event.target
    if (
      target instanceof Element &&
      target.closest('button, a, input, textarea, select, [contenteditable="true"]')
    ) {
      return
    }
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div
      className={styles.page}
      onPointerDown={handleSelectionPointerDown}
      onClick={handleSelectionClick}
    >
      {/* 顶部返回栏 */}
      <div className={styles.topbar}>
        <button
          className={styles.backButton}
          onClick={() => navigate('/lessons')}
        >
          <ArrowLeft size={18} strokeWidth={2} />
          <span>{t('lesson.backToList')}</span>
        </button>
      </div>

      {/* 标题区 */}
      <div className={`${styles.header} liquid-glass`}>
        <div className={styles.headerMeta}>
          <span
            className={`${styles.priorityTag} ${styles[`priority_${lesson.priority}`]}`}
          >
            {t(priorityLabel[lesson.priority])}
          </span>
          <span className={styles.order}>{t('lesson.orderLabel').replace('{n}', String(lesson.order))}</span>
          {isCompleted && (
            <span className={styles.completedBadge}>
              <CheckCircle size={14} strokeWidth={2.2} />
              {t('lessons.statusDone')}
            </span>
          )}
        </div>
        <h1 className={styles.title}>{lesson.title}</h1>
        {content && !regenerating && (
          <div className={styles.contentVersionActions}>
            {!confirmingRegenerate ? (
              <>
                <button
                  type="button"
                  className={styles.versionAction}
                  disabled={courseOptimizationBusy || grading || reviewInFlight}
                  onClick={() => {
                    setContentNotice(null)
                    setConfirmingRegenerate(true)
                  }}
                >
                  <RefreshCw size={15} strokeWidth={2} />
                  <span>{t('lesson.regenerateContent')}</span>
                </button>
                {lesson.previousContent && (
                  <button
                    type="button"
                    className={styles.versionAction}
                    disabled={courseOptimizationBusy || grading || reviewInFlight}
                    onClick={handleRestorePrevious}
                  >
                    <History size={15} strokeWidth={2} />
                    <span>{t('lesson.restorePrevious')}</span>
                  </button>
                )}
              </>
            ) : (
              <div className={styles.regenerateConfirm}>
                <span>{t('lesson.regenerateContentHint')}</span>
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={courseOptimizationBusy || grading || reviewInFlight}
                >
                  {t('lesson.confirmRegenerate')}
                </button>
                <button type="button" onClick={() => setConfirmingRegenerate(false)}>
                  {t('lessons.batchCancel')}
                </button>
              </div>
            )}
          </div>
        )}
        {(contentNotice || optimizedSuccessfully) && (
          <div className={styles.contentNotice} role="status">
            <CheckCircle size={14} strokeWidth={2} />
            <span>{contentNotice ?? t('lesson.regenerateSuccess')}</span>
          </div>
        )}
        {optimizationCancelled && (
          <div className={styles.contentCancelled} role="status">
            <X size={14} strokeWidth={2} />
            <span>{t('lesson.regenerateCancelled')}</span>
          </div>
        )}
        {optimizationError && !regenerating && (
          <div className={styles.error} role="alert">
            <X size={14} strokeWidth={2} />
            <span>{optimizationError}</span>
          </div>
        )}
      </div>

      {/* 手动重新生成中 */}
      {regenerating && (
        <div className={`${styles.loadingCard} liquid-glass`}>
          <LoaderCircle size={38} className={styles.spinnerIcon} aria-hidden="true" />
          <p className={styles.loadingText}>{t('lesson.regenerating')}</p>
          <button
            type="button"
            className={styles.loadingCancel}
            onClick={() => courseId && cancelCourseOptimization(courseId)}
          >
            <X size={14} strokeWidth={2} />
            <span>{t('lessons.batchCancel')}</span>
          </button>
        </div>
      )}

      {/* 内容已存在：直接显示 */}
      {!regenerating && content && (
        <>
          {/* Tab 切换 */}
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === 'points' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('points')}
            >
              <Lightbulb size={16} strokeWidth={2} />
              <span>{t('lesson.tabPoints')}</span>
            </button>
            <button
              className={`${styles.tab} ${tab === 'examples' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('examples')}
            >
              <PenTool size={16} strokeWidth={2} />
              <span>{t('lesson.examples')}</span>
            </button>
            {content.quiz.length > 0 && (
              <button
                className={`${styles.tab} ${tab === 'quiz' ? styles.tabActive : ''}`}
                onClick={() => handleTabChange('quiz')}
              >
                <HelpCircle size={16} strokeWidth={2} />
                <span>{t('lesson.quiz')}</span>
              </button>
            )}
          </div>

          {/* 知识点 */}
          {tab === 'points' && (
            <div className={`${styles.contentCard} liquid-glass`}>
              {content.learningDesign && (
                <details className={styles.learningDesign}>
                  <summary>{t('progress.designTitle')}</summary>
                  <ul>{content.learningDesign.objectives.map((objective, index) => <li key={index}>{objective}</li>)}</ul>
                  <p>{content.learningDesign.approach}</p>
                  <p className={styles.designReason}>{content.learningDesign.rationale}</p>
                </details>
              )}
              <h2 className={styles.sectionTitle}>
                <Lightbulb size={18} strokeWidth={2} />
                {t('lesson.keyPoints')}
              </h2>
              <ul className={styles.keyPoints}>
                {content.keyPoints.map((point, i) => (
                  <li key={i} className={styles.keyPoint}>
                    <span className={styles.keyPointDot} />
                    <span
                      className={styles.markdownContent}
                      dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(point) }}
                    />
                  </li>
                ))}
              </ul>

              <h2 className={styles.sectionTitle}>
                <PenTool size={18} strokeWidth={2} />
                {t('lesson.explanationTitle')}
              </h2>
              <div
                className={`${styles.explanation} ${styles.markdownContent}`}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content.explanation) }}
              />
            </div>
          )}

          {/* 例题 */}
          {tab === 'examples' && (
            <div className={styles.contentList}>
              {content.examples.length === 0 && (
                <div className={`${styles.emptyHint} liquid-glass`}>
                  {t('lesson.noExamples')}
                </div>
              )}
              {content.examples.map((ex, i) => (
                <div key={i} className={`${styles.exampleCard} liquid-glass`}>
                  <div className={styles.exampleHeader}>{t('lesson.exampleN').replace('{n}', String(i + 1))}</div>
                  <div
                    className={`${styles.exampleQuestion} ${styles.markdownContent}`}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(ex.question) }}
                  />
                  {ex.steps && ex.steps.length > 0 && (
                    <div className={styles.exampleSteps}>
                      <div className={styles.stepsLabel}>{t('lesson.stepsLabel')}</div>
                      {ex.steps.map((step, j) => (
                        <div key={j} className={styles.step}>
                          <span className={styles.stepIndex}>{j + 1}</span>
                          <span
                            className={styles.markdownContent}
                            dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(step) }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={styles.exampleAnswer}>
                    <span className={styles.answerLabel}>{t('lesson.answerLabel')}</span>
                    <span
                      className={`${styles.answerText} ${styles.markdownContent}`}
                      dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(ex.answer) }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 小测 */}
          {tab === 'quiz' && (
            <div className={styles.contentList}>
              {quizQuestions.length === 0 ? (
                <div className={`${styles.emptyHint} liquid-glass`}>
                  {t('lesson.noQuiz')}
                </div>
              ) : (
                <>
                  {/* 进度点 */}
                  <div className={styles.quizProgress}>
                    {quizQuestions.map((_, i) => {
                      const isCompleted = pageSolved.has(i)
                      const isCurrent = i === quizPage
                      let dotClass = styles.progressDot
                      if (isCompleted) {
                        dotClass += ` ${styles.progressDotCompleted}`
                      } else if (isCurrent) {
                        dotClass += ` ${styles.progressDotCurrent}`
                      } else {
                        dotClass += ` ${styles.progressDotLocked}`
                      }
                      return (
                        <div
                          key={i}
                          className={dotClass}
                          onClick={() => isCompleted && handleNavigateToPage(i)}
                        >
                          {isCompleted && <Check size={10} strokeWidth={3} />}
                        </div>
                      )
                    })}
                  </div>

                  {/* 当前题目 */}
                  {(() => {
                    const q = quizQuestions[quizPage]
                    if (!q) return null
                    const qType: QuizType = q.type || 'choice'
                    const isSolved = pageSolved.has(quizPage)
                    const isLastPage = quizPage === quizQuestions.length - 1
                    const allSolved = pageSolved.size === quizQuestions.length
                    const answerUnavailable = feedback?.status === 'unavailable'
                    const answers = referenceAnswers(q)
                    // 本题是否答错（答错后展示「复核」按钮，由用户决定是否请 AI 复判）
                    const answeredWrong =
                      (qType === 'choice' && revealed && choiceSelected !== q.correctIndex) ||
                      (qType === 'multi' &&
                        multiSubmitted &&
                        !(
                          multiSelected.size === q.correctIndices?.length &&
                          [...multiSelected].every(i => q.correctIndices?.includes(i))
                        )) ||
                      ((qType === 'fill' || qType === 'short') &&
                        feedback?.correct === false &&
                        !answerUnavailable)

                    return (
                      <div className={`${styles.quizPageCard} liquid-glass`}>
                        <div className={styles.quizHeader}>
                          <span>{t('lesson.questionN').replace('{cur}', String(quizPage + 1)).replace('{total}', String(quizQuestions.length))}</span>
                          <span className={styles.quizTypeTag}>
                            {qType === 'choice' ? t('lesson.qTypeChoice') : qType === 'multi' ? t('lesson.qTypeMulti') : qType === 'fill' ? t('lesson.qTypeFill') : t('lesson.qTypeShort')}
                          </span>
                        </div>
                        {q.objective && <p className={styles.questionObjective}>{q.taskKind && <span>{q.taskKind} · </span>}{t('progress.practiceObjective')}{q.objective}</p>}
                        <div
                          className={`${styles.quizQuestion} ${styles.markdownContent}`}
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(q.question) }}
                        />

                        {/* 单选题 */}
                        {qType === 'choice' && q.options && (
                          <div className={styles.quizOptions}>
                            {q.options.map((opt, oi) => {
                              const isCorrect = oi === q.correctIndex
                              const isSelected = choiceSelected === oi
                              let cls = styles.quizOption
                              if (revealed) {
                                if (isCorrect) {
                                  cls = `${styles.quizOption} ${styles.quizOptionCorrect}`
                                } else if (isSelected) {
                                  cls = `${styles.quizOption} ${styles.quizOptionWrong}`
                                } else {
                                  cls = `${styles.quizOption} ${styles.quizOptionDim}`
                                }
                              }
                              return (
                                <button
                                  key={oi}
                                  className={cls}
                                  onClick={() => handleChoiceAnswer(oi)}
                                  disabled={revealed || lessonMutationLocked}
                                >
                                  <span className={styles.optionLabel}>
                                    {String.fromCharCode(65 + oi)}
                                  </span>
                                  <span
                                    className={`${styles.optionText} ${styles.markdownContent}`}
                                    dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(cleanOptionText(opt)) }}
                                  />
                                  {revealed && isCorrect && (
                                    <Check size={16} className={styles.optionIcon} />
                                  )}
                                  {revealed && isSelected && !isCorrect && (
                                    <X size={16} className={styles.optionIcon} />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        )}

                        {/* 多选题 */}
                        {qType === 'multi' && q.options && (
                          <>
                            <div className={styles.quizOptions}>
                              {q.options.map((opt, oi) => {
                                const isCorrect = q.correctIndices?.includes(oi)
                                const isSelected = multiSelected.has(oi)
                                let cls = styles.quizOption
                                if (multiSubmitted) {
                                  if (isCorrect) {
                                    cls = `${styles.quizOption} ${styles.quizOptionCorrect}`
                                  } else if (isSelected) {
                                    cls = `${styles.quizOption} ${styles.quizOptionWrong}`
                                  } else {
                                    cls = `${styles.quizOption} ${styles.quizOptionDim}`
                                  }
                                } else if (isSelected) {
                                  cls = `${styles.quizOption} ${styles.quizOptionSelected}`
                                }
                                return (
                                  <button
                                    key={oi}
                                    className={cls}
                                    onClick={() => handleMultiToggle(oi)}
                                    disabled={multiSubmitted || lessonMutationLocked}
                                  >
                                    <span className={styles.optionLabel}>
                                      {String.fromCharCode(65 + oi)}
                                    </span>
                                    <span
                                      className={`${styles.optionText} ${styles.markdownContent}`}
                                      dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(cleanOptionText(opt)) }}
                                    />
                                    {multiSubmitted && isCorrect && (
                                      <Check size={16} className={styles.optionIcon} />
                                    )}
                                    {multiSubmitted && isSelected && !isCorrect && (
                                      <X size={16} className={styles.optionIcon} />
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                            {/* 多选题解析 */}
                            {multiSubmitted && (
                              <div
                                className={`${styles.quizExplanation} ${
                                  multiSelected.size === q.correctIndices?.length &&
                                  [...multiSelected].every(i => q.correctIndices?.includes(i))
                                    ? styles.quizExplanationCorrect
                                    : styles.quizExplanationWrong
                                }`}
                              >
                                <span className={styles.explanationLabel}>
                                  {multiSelected.size === q.correctIndices?.length &&
                                  [...multiSelected].every(i => q.correctIndices?.includes(i))
                                    ? t('lesson.answerCorrect')
                                    : t('lesson.answerWrong')}
                                </span>
                                <span
                                  className={styles.markdownContent}
                                  dangerouslySetInnerHTML={{
                                    __html: renderInlineMarkdown(q.explanation),
                                  }}
                                />
                              </div>
                            )}
                          </>
                        )}

                        {/* 填空题 */}
                        {qType === 'fill' && (
                          <input
                            type="text"
                            className={styles.textInput}
                            value={textAnswer}
                            onChange={e => {
                              if (currentQuestionId) {
                                invalidateQuizQuestionRequests(courseId, lesson.id, currentQuestionId)
                                patchAttempt(currentQuestionId, { textAnswer: e.target.value })
                              }
                            }}
                            placeholder={t('lesson.yourAnswerPlaceholder')}
                            disabled={feedback?.correct === true || reviewInFlight || lessonMutationLocked}
                            onKeyDown={e => {
                              if (
                                e.key === 'Enter' &&
                                !e.nativeEvent.isComposing &&
                                !grading &&
                                feedback?.correct !== true
                              ) {
                                handleSubmitText()
                              }
                            }}
                          />
                        )}

                        {/* 简答题 */}
                        {qType === 'short' && (
                          <textarea
                            className={styles.textareaInput}
                            value={textAnswer}
                            onChange={e => {
                              if (currentQuestionId) {
                                invalidateQuizQuestionRequests(courseId, lesson.id, currentQuestionId)
                                patchAttempt(currentQuestionId, { textAnswer: e.target.value })
                              }
                            }}
                            placeholder={t('lesson.yourAnswerPlaceholder')}
                            disabled={feedback?.correct === true || reviewInFlight || lessonMutationLocked}
                            rows={4}
                          />
                        )}

                        {/* 操作行：查看答案不影响原有提交、重试和跳过逻辑。 */}
                        <div className={styles.quizActionRow}>
                          <div className={styles.quizNavLeft}>
                            {/* 重新生成：生成同知识点的新题 */}
                            <button
                              className={styles.regenerateBtn}
                              onClick={handleRegenerateQuestion}
                              disabled={grading || reviewInFlight || lessonMutationLocked}
                              title={t('lesson.regenerateTitle')}
                            >
                              {grading ? (
                                <LoaderCircle size={14} className={styles.submitSpinner} />
                              ) : (
                                <RefreshCw size={14} strokeWidth={2} />
                              )}
                              <span>{t('lesson.regenerate')}</span>
                            </button>
                            <button
                              type="button"
                              className={styles.revealAnswerBtn}
                              onClick={handleToggleAnswer}
                              disabled={grading || reviewInFlight || lessonMutationLocked}
                              aria-expanded={answerVisible}
                              aria-controls="quiz-reference-answer"
                            >
                              {answerVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                              <span>{t(answerVisible ? 'lesson.hideAnswer' : 'lesson.showAnswer')}</span>
                            </button>
                            {/* 跳过：直接进入下一题 */}
                            <button
                              className={styles.skipBtn}
                              onClick={handleSkipQuestion}
                              disabled={grading || isSolved || reviewInFlight || lessonMutationLocked}
                              title={t('lesson.skipTitle')}
                            >
                              <SkipForward size={14} strokeWidth={2} />
                              <span>{t('lesson.skipCost')}</span>
                            </button>
                            {/* 答错后的 AI 复核（四种题型通用）：用户有疑问时自主发起 */}
                            {(!review || review.state === 'error') && answeredWrong && (
                                <button
                                  className={styles.reviewBtn}
                                  onClick={handleReview}
                                  disabled={lessonMutationLocked}
                                  title={t('lesson.reviewTitle')}
                                >
                                  <Sparkles size={14} strokeWidth={2} />
                                  <span>{review?.state === 'error' ? t('lesson.retryReview') : t('lesson.review')}</span>
                                </button>
                              )}
                            {/* 答错后的再试一次 */}
                            {qType === 'choice' &&
                              revealed &&
                              choiceSelected !== q.correctIndex && (
                                <button
                                  className={styles.retryBtn}
                                  onClick={handleRetryChoice}
                                  disabled={reviewInFlight || lessonMutationLocked}
                                >
                                  <RefreshCw size={14} strokeWidth={2} />
                                  <span>{t('lesson.tryAgain')}</span>
                                </button>
                              )}
                            {qType === 'multi' &&
                              multiSubmitted &&
                              !(
                                multiSelected.size === q.correctIndices?.length &&
                                [...multiSelected].every(i => q.correctIndices?.includes(i))
                              ) && (
                                <button
                                  className={styles.retryBtn}
                                  onClick={handleRetryMulti}
                                  disabled={reviewInFlight || lessonMutationLocked}
                                >
                                  <RefreshCw size={14} strokeWidth={2} />
                                  <span>{t('lesson.tryAgain')}</span>
                                </button>
                              )}
                          </div>
                          <div className={styles.quizActionRight}>
                            {/* 多选提交 */}
                            {qType === 'multi' && !multiSubmitted && (
                              <button
                                className={styles.submitBtn}
                                onClick={handleMultiSubmit}
                                disabled={multiSelected.size === 0 || lessonMutationLocked}
                              >
                                {t('lesson.submitWithCount').replace('{count}', String(multiSelected.size))}
                              </button>
                            )}
                            {/* 填空/简答提交 */}
                            {(qType === 'fill' || qType === 'short') &&
                              feedback?.correct !== true && (
                                <button
                                  className={styles.submitBtn}
                                  onClick={handleSubmitText}
                                disabled={grading || reviewInFlight || !textAnswer.trim() || lessonMutationLocked}
                                >
                                  {grading && (
                                    <LoaderCircle size={16} className={styles.submitSpinner} />
                                  )}
                                  {grading
                                    ? t('lesson.grading')
                                    : answerUnavailable
                                      ? t('lesson.retryGrading')
                                      : t('lesson.submit')}
                                </button>
                              )}
                          </div>
                        </div>

                        {answerVisible && (
                          <section id="quiz-reference-answer" className={styles.referenceAnswer} aria-label={t('lesson.standardAnswer')}>
                            <div className={styles.referenceAnswerHeading}>
                              <Eye size={16} aria-hidden="true" />
                              <span>{t('lesson.answerViewed')}</span>
                            </div>
                            <p className={styles.referenceAnswerHint}>{t('lesson.answerViewHint')}</p>
                            <span className={styles.explanationLabel}>{t('lesson.standardAnswer')}</span>
                            {answers.length > 0 ? answers.map((answer, index) => (
                              <div
                                key={index}
                                className={styles.markdownContent}
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }}
                              />
                            )) : <p className={styles.referenceAnswerHint}>{t('lesson.referenceUnavailable')}</p>}
                            {q.explanation?.trim() && (
                              <>
                                <span className={styles.explanationLabel}>{t('lesson.explanationTitle')}</span>
                                <div
                                  className={styles.markdownContent}
                                  dangerouslySetInnerHTML={{ __html: renderMarkdown(q.explanation) }}
                                />
                              </>
                            )}
                          </section>
                        )}

                        {/* 反馈（填空/简答） */}
                        {feedback && (
                          <div
                            className={`${styles.feedback} ${
                              feedback.correct
                                ? styles.feedbackCorrect
                                : answerUnavailable
                                  ? styles.feedbackUnavailable
                                  : styles.feedbackWrong
                            }`}
                          >
                            <span className={styles.explanationLabel}>
                              {feedback.correct
                                ? t('lesson.answerCorrect')
                                : answerUnavailable
                                  ? t('lesson.answerUngradeable')
                                  : t('lesson.answerWrong')}
                            </span>
                            <span>{feedback.text}</span>
                          </div>
                        )}

                        {/* 标准答案（填空/简答题判定后始终显示） */}
                        {feedback && q.answer && !answerVisible && (
                          <div className={styles.feedback}>
                            <span className={styles.explanationLabel}>{t('lesson.standardAnswer')}</span>
                            <span
                              className={styles.markdownContent}
                              dangerouslySetInnerHTML={{
                                __html: renderInlineMarkdown(q.answer),
                              }}
                            />
                          </div>
                        )}

                        {/* AI 复核结果框：可收起 */}
                        {review && (
                          <div
                            className={`${styles.reviewBox} ${
                              review.state === 'error'
                                ? styles.reviewBoxError
                                : review.state === 'done' && review.userCorrect
                                  ? styles.reviewBoxCorrect
                                  : styles.reviewBoxWrong
                            }`}
                          >
                            <button
                              type="button"
                              className={styles.reviewHeader}
                              onClick={() => {
                                if (currentQuestionId && review.state !== 'running') {
                                  patchAttempt(currentQuestionId, {
                                    review: { ...review, collapsed: !review.collapsed },
                                  })
                                }
                              }}
                              aria-expanded={!review.collapsed}
                            >
                              <Sparkles size={14} strokeWidth={2} />
                              <span className={styles.reviewTitleText}>
                                {review.state === 'running'
                                  ? t('lesson.reviewRunning')
                                  : review.state === 'error'
                                    ? t('lesson.reviewFailed')
                                    : review.userCorrect
                                      ? t('lesson.reviewYouWereRight')
                                      : t('lesson.reviewYouWereWrong')}
                              </span>
                              {review.state !== 'running' && (
                                <ChevronDown
                                  size={15}
                                  strokeWidth={2}
                                  className={`${styles.reviewChevron} ${review.collapsed ? '' : styles.reviewChevronOpen}`}
                                />
                              )}
                            </button>
                            {!review.collapsed && review.state !== 'running' && (
                              <div
                                className={styles.reviewBody}
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(review.text) }}
                              />
                            )}
                            {review.state === 'running' && (
                              <div className={styles.reviewBody}>
                                <LoaderCircle size={14} className={styles.submitSpinner} />
                              </div>
                            )}
                          </div>
                        )}

                        {/* 解析（选择题） */}
                        {qType === 'choice' && revealed && (
                          <div
                            className={`${styles.quizExplanation} ${
                              choiceSelected === q.correctIndex
                                ? styles.quizExplanationCorrect
                                : styles.quizExplanationWrong
                            }`}
                          >
                            <span className={styles.explanationLabel}>
                              {choiceSelected === q.correctIndex ? t('lesson.answerCorrect') : t('lesson.answerWrong')}
                            </span>
                            <span
                              className={styles.markdownContent}
                              dangerouslySetInnerHTML={{
                                __html: renderInlineMarkdown(q.explanation),
                              }}
                            />
                          </div>
                        )}

                        {/* 导航：下一题 / 完成关卡 */}
                        <div className={styles.quizNav}>
                          <div />
                          <div>
                            {isSolved && !isLastPage && (
                              <button
                                className={styles.quizNavBtn}
                                onClick={handleNextPage}
                              >
                                <span>{t('lesson.nextPage')}</span>
                              </button>
                            )}
                            {isSolved && isLastPage && allSolved && !isCompleted && (
                              <button
                                className={styles.quizNavBtn}
                                onClick={handleComplete}
                                disabled={lessonMutationLocked}
                              >
                                <CheckCircle size={16} strokeWidth={2} />
                                <span>{t('lesson.finish')}</span>
                              </button>
                            )}
                            {isSolved && isLastPage && allSolved && isCompleted && (
                              <div className={styles.alreadyCompleted}>
                                <CheckCircle size={16} strokeWidth={2} />
                                <span>{t('lesson.completed')}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* 内容正在后台生成中 */}
      {!regenerating && !content && generatingLessons && (
        <div className={`${styles.loadingCard} liquid-glass`}>
          <LoaderCircle size={38} className={styles.spinnerIcon} aria-hidden="true" />
          <p className={styles.loadingText}>{t('lesson.generatingWait')}</p>
          <ReadyLessonNotice bundle={bundle} />
        </div>
      )}

      {/* 生成失败：显示重新生成按钮 */}
      {!regenerating && !content && !generatingLessons && (
        <div className={`${styles.startCard} liquid-glass`}>
          {error && (
            <div className={styles.error}>
              <X size={16} strokeWidth={2} />
              <span>{error}</span>
            </div>
          )}
          <div className={styles.startIcon}>
            <AlertCircle size={40} strokeWidth={1.5} />
          </div>
          <p className={styles.startText}>
            {t('lesson.genFailedManual')}
          </p>
          <button
            className={styles.startButton}
            onClick={handleRegenerate}
            disabled={courseOptimizationBusy || grading || reviewInFlight}
          >
            <RefreshCw size={18} strokeWidth={2} />
            <span>{t('lesson.regenerate')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
