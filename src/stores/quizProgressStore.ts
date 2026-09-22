import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { learningDataStorage } from '../services/learningDataStorage'
import type { QuizQuestion } from '../types/index'

export const QUIZ_PROGRESS_STORAGE_KEY = 'chillpass-quiz-progress-v1'

export type QuizContentTab = 'points' | 'examples' | 'quiz'

export interface QuizQuestionRef {
  id: string
  fingerprint: string
}

export interface StoredQuizReview {
  state: 'done' | 'error'
  userCorrect?: boolean
  text: string
  collapsed: boolean
}

export type QuizFeedbackStatus = 'correct' | 'incorrect' | 'unavailable'

export interface QuizFeedback {
  correct: boolean
  /** unavailable 表示评阅服务没有给出可用结论，不能视为答错。 */
  status: QuizFeedbackStatus
  text: string
}

export interface QuizQuestionProgress {
  choiceSelected: number | null
  multiSelected: number[]
  multiSubmitted: boolean
  textAnswer: string
  feedback: QuizFeedback | null
  /** 仅控制参考答案展开，不代表已提交、答对或跳过。 */
  answerVisible: boolean
  revealed: boolean
  solved: boolean
  skipped: boolean
  review: StoredQuizReview | null
  wrongEntryId?: string
}

export interface LessonQuizProgress {
  courseId: string
  lessonId: string
  activeTab: QuizContentTab
  currentQuestionId: string | null
  questionRefs: QuizQuestionRef[]
  attempts: Record<string, QuizQuestionProgress>
  updatedAt: number
}

interface QuizProgressState {
  byLesson: Record<string, LessonQuizProgress>
  previousByLesson: Record<string, LessonQuizProgress>
  /** 最近一次已执行的归档操作，用于刷新续跑时保证归档幂等。 */
  archiveOperationByLesson: Record<string, string>
  syncLesson: (
    courseId: string,
    lessonId: string,
    questionRefs: QuizQuestionRef[],
    currentQuestionId?: string,
  ) => void
  setActiveTab: (
    courseId: string,
    lessonId: string,
    questionRefs: QuizQuestionRef[],
    tab: QuizContentTab,
  ) => void
  setCurrentQuestion: (
    courseId: string,
    lessonId: string,
    questionRefs: QuizQuestionRef[],
    questionId: string,
  ) => void
  patchAttempt: (
    courseId: string,
    lessonId: string,
    questionRefs: QuizQuestionRef[],
    questionId: string,
    patch: Partial<QuizQuestionProgress>,
  ) => void
  resetAttempt: (
    courseId: string,
    lessonId: string,
    questionRefs: QuizQuestionRef[],
    questionId: string,
    keepWrongEntryId?: boolean,
  ) => void
  clearLesson: (courseId: string, lessonId: string) => void
  clearCourse: (courseId: string) => void
  archiveLesson: (courseId: string, lessonId: string) => void
  archiveLessonOnce: (courseId: string, lessonId: string, operationId: string) => void
  restoreArchivedLesson: (courseId: string, lessonId: string) => boolean
}

export function quizProgressKey(courseId: string, lessonId: string): string {
  return `${courseId}:${lessonId}`
}

// 运行中的 AI 请求不落盘，但需要跨组件卸载保持代次，防止旧响应覆盖新进度。
const requestGenerations = new Map<string, number>()
let nextRequestGeneration = 0

function requestGenerationKey(courseId: string, lessonId: string, questionId: string): string {
  return `${courseId}\u0000${lessonId}\u0000${questionId}`
}

export function beginQuizQuestionRequest(
  courseId: string,
  lessonId: string,
  questionId: string,
): number {
  const key = requestGenerationKey(courseId, lessonId, questionId)
  const generation = ++nextRequestGeneration
  requestGenerations.set(key, generation)
  return generation
}

export function invalidateQuizQuestionRequests(
  courseId: string,
  lessonId: string,
  questionId: string,
): void {
  beginQuizQuestionRequest(courseId, lessonId, questionId)
}

/** 关卡内容即将整体替换时，使该关卡所有旧题的在途响应立即失效。 */
export function invalidateQuizLessonRequests(courseId: string, lessonId: string): void {
  const prefix = `${courseId}\u0000${lessonId}\u0000`
  for (const key of requestGenerations.keys()) {
    if (key.startsWith(prefix)) requestGenerations.set(key, ++nextRequestGeneration)
  }
}

export function isQuizQuestionRequestCurrent(
  courseId: string,
  lessonId: string,
  questionId: string,
  generation: number,
): boolean {
  return requestGenerations.get(requestGenerationKey(courseId, lessonId, questionId)) === generation
}

function clearRequestGenerations(courseId: string, lessonId?: string): void {
  const prefix = lessonId ? `${courseId}\u0000${lessonId}\u0000` : `${courseId}\u0000`
  for (const key of requestGenerations.keys()) {
    if (key.startsWith(prefix)) requestGenerations.delete(key)
  }
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/**
 * 题目 id 用于定位进度；fingerprint 识别题干、选项或目标/评价标准的变化。
 * 正确答案不参与 fingerprint，AI 复核修正参考答案时不会意外清空用户作答。
 */
export function makeQuizQuestionRefs(
  lessonId: string,
  questions: QuizQuestion[],
): QuizQuestionRef[] {
  return questions.map((question, index) => ({
    id: question.id?.trim() || `legacy:${lessonId}:${index}`,
    fingerprint: hashString(
      JSON.stringify([
        question.type || 'choice', question.question, question.options ?? [],
        // Keep the original three fields exactly for legacy content: no progress reset on upgrade.
        ...(question.objective || question.taskKind || question.gradingCriteria?.length
          ? [{ objective: question.objective, taskKind: question.taskKind, gradingCriteria: question.gradingCriteria }] : []),
      ]),
    ),
  }))
}

export function createEmptyQuizAttempt(): QuizQuestionProgress {
  return {
    choiceSelected: null,
    multiSelected: [],
    multiSubmitted: false,
    textAnswer: '',
    feedback: null,
    answerVisible: false,
    revealed: false,
    solved: false,
    skipped: false,
    review: null,
  }
}

function normalizeAttempt(value: QuizQuestionProgress | undefined): QuizQuestionProgress {
  const empty = createEmptyQuizAttempt()
  if (!value || typeof value !== 'object') return empty
  return {
    ...empty,
    ...value,
    choiceSelected: typeof value.choiceSelected === 'number' ? value.choiceSelected : null,
    multiSelected: Array.isArray(value.multiSelected)
      ? value.multiSelected.filter(index => Number.isInteger(index))
      : [],
    multiSubmitted: value.multiSubmitted === true,
    textAnswer: typeof value.textAnswer === 'string' ? value.textAnswer : '',
    feedback:
      value.feedback && typeof value.feedback.text === 'string'
        ? {
            correct: value.feedback.correct === true,
            status:
              value.feedback.status === 'correct' ||
              value.feedback.status === 'incorrect' ||
              value.feedback.status === 'unavailable'
                ? value.feedback.status
                : value.feedback.correct === true
                  ? 'correct'
                  : 'incorrect',
            text: value.feedback.text,
          }
        : null,
    answerVisible: value.answerVisible === true,
    revealed: value.revealed === true,
    solved: value.solved === true,
    skipped: value.skipped === true,
    review:
      value.review &&
      (value.review.state === 'done' || value.review.state === 'error') &&
      typeof value.review.text === 'string'
        ? {
            state: value.review.state,
            userCorrect: value.review.userCorrect,
            text: value.review.text,
            collapsed: value.review.collapsed === true,
          }
        : null,
    ...(typeof value.wrongEntryId === 'string' ? { wrongEntryId: value.wrongEntryId } : {}),
  }
}

function reconcileLesson(
  existing: LessonQuizProgress | undefined,
  courseId: string,
  lessonId: string,
  questionRefs: QuizQuestionRef[],
  currentQuestionId?: string,
): LessonQuizProgress {
  const oldRefs = new Map(existing?.questionRefs.map(ref => [ref.id, ref.fingerprint]) ?? [])
  const attempts: Record<string, QuizQuestionProgress> = {}

  for (const ref of questionRefs) {
    if (oldRefs.get(ref.id) === ref.fingerprint && existing?.attempts[ref.id]) {
      attempts[ref.id] = normalizeAttempt(existing.attempts[ref.id])
    }
  }

  const validIds = new Set(questionRefs.map(ref => ref.id))
  const requestedCurrentId = currentQuestionId ?? existing?.currentQuestionId ?? null
  const fallbackCurrentId =
    questionRefs.find(ref => !attempts[ref.id]?.solved)?.id ?? questionRefs.at(-1)?.id ?? null
  const nextCurrentId =
    requestedCurrentId && validIds.has(requestedCurrentId)
      ? requestedCurrentId
      : fallbackCurrentId

  const previousTab = existing?.activeTab
  const activeTab: QuizContentTab =
    previousTab === 'examples' || previousTab === 'quiz' || previousTab === 'points'
      ? previousTab === 'quiz' && questionRefs.length === 0
        ? 'points'
        : previousTab
      : 'points'

  return {
    courseId,
    lessonId,
    activeTab,
    currentQuestionId: nextCurrentId,
    questionRefs,
    attempts,
    updatedAt: Date.now(),
  }
}

export const useQuizProgressStore = create<QuizProgressState>()(
  persist(
    (set) => ({
      byLesson: {},
      previousByLesson: {},
      archiveOperationByLesson: {},

      archiveLesson: (courseId, lessonId) => {
        const key = quizProgressKey(courseId, lessonId)
        set(state => {
          const current = state.byLesson[key]
          if (!current) return state
          return {
            previousByLesson: {
              ...state.previousByLesson,
              [key]: current,
            },
          }
        })
      },

      archiveLessonOnce: (courseId, lessonId, operationId) => {
        const key = quizProgressKey(courseId, lessonId)
        set(state => {
          if (state.archiveOperationByLesson[key] === operationId) return state
          const current = state.byLesson[key]
          return {
            ...(current
              ? { previousByLesson: { ...state.previousByLesson, [key]: current } }
              : {}),
            archiveOperationByLesson: {
              ...state.archiveOperationByLesson,
              [key]: operationId,
            },
          }
        })
      },

      restoreArchivedLesson: (courseId, lessonId) => {
        const key = quizProgressKey(courseId, lessonId)
        let restored = false
        set(state => {
          const archived = state.previousByLesson[key]
          if (!archived) return state
          restored = true
          const current = state.byLesson[key]
          const nextPrevious = { ...state.previousByLesson }
          if (current) nextPrevious[key] = current
          else delete nextPrevious[key]
          return {
            byLesson: { ...state.byLesson, [key]: archived },
            previousByLesson: nextPrevious,
          }
        })
        return restored
      },

      syncLesson: (courseId, lessonId, questionRefs, currentQuestionId) => {
        const key = quizProgressKey(courseId, lessonId)
        set(state => ({
          byLesson: {
            ...state.byLesson,
            [key]: reconcileLesson(
              state.byLesson[key],
              courseId,
              lessonId,
              questionRefs,
              currentQuestionId,
            ),
          },
        }))
      },

      setActiveTab: (courseId, lessonId, questionRefs, tab) => {
        const key = quizProgressKey(courseId, lessonId)
        set(state => {
          const progress = reconcileLesson(
            state.byLesson[key],
            courseId,
            lessonId,
            questionRefs,
          )
          return {
            byLesson: {
              ...state.byLesson,
              [key]: { ...progress, activeTab: tab, updatedAt: Date.now() },
            },
          }
        })
      },

      setCurrentQuestion: (courseId, lessonId, questionRefs, questionId) => {
        const key = quizProgressKey(courseId, lessonId)
        set(state => ({
          byLesson: {
            ...state.byLesson,
            [key]: reconcileLesson(
              state.byLesson[key],
              courseId,
              lessonId,
              questionRefs,
              questionId,
            ),
          },
        }))
      },

      patchAttempt: (courseId, lessonId, questionRefs, questionId, patch) => {
        const key = quizProgressKey(courseId, lessonId)
        set(state => {
          const progress = reconcileLesson(
            state.byLesson[key],
            courseId,
            lessonId,
            questionRefs,
          )
          if (!questionRefs.some(ref => ref.id === questionId)) return state
          const current = normalizeAttempt(progress.attempts[questionId])
          return {
            byLesson: {
              ...state.byLesson,
              [key]: {
                ...progress,
                attempts: {
                  ...progress.attempts,
                  [questionId]: normalizeAttempt({ ...current, ...patch }),
                },
                updatedAt: Date.now(),
              },
            },
          }
        })
      },

      resetAttempt: (courseId, lessonId, questionRefs, questionId, keepWrongEntryId = true) => {
        const key = quizProgressKey(courseId, lessonId)
        set(state => {
          // 题目洗牌会改变 fingerprint；先从旧记录取错题 id，再做 reconcile。
          const previousWrongEntryId = state.byLesson[key]?.attempts[questionId]?.wrongEntryId
          const progress = reconcileLesson(
            state.byLesson[key],
            courseId,
            lessonId,
            questionRefs,
            questionId,
          )
          if (!questionRefs.some(ref => ref.id === questionId)) return state
          const attempt = createEmptyQuizAttempt()
          if (keepWrongEntryId && previousWrongEntryId) {
            attempt.wrongEntryId = previousWrongEntryId
          }
          return {
            byLesson: {
              ...state.byLesson,
              [key]: {
                ...progress,
                currentQuestionId: questionId,
                attempts: { ...progress.attempts, [questionId]: attempt },
                updatedAt: Date.now(),
              },
            },
          }
        })
      },

      clearLesson: (courseId, lessonId) => {
        clearRequestGenerations(courseId, lessonId)
        const key = quizProgressKey(courseId, lessonId)
        set(state => {
          if (!state.byLesson[key] && !state.previousByLesson[key] && !state.archiveOperationByLesson[key]) return state
          const { [key]: _current, ...remaining } = state.byLesson
          const { [key]: _previous, ...remainingPrevious } = state.previousByLesson
          const { [key]: _operation, ...remainingOperations } = state.archiveOperationByLesson
          return {
            byLesson: remaining,
            previousByLesson: remainingPrevious,
            archiveOperationByLesson: remainingOperations,
          }
        })
      },

      clearCourse: (courseId) => {
        clearRequestGenerations(courseId)
        set(state => {
          const remaining = Object.fromEntries(
            Object.entries(state.byLesson).filter(([, progress]) => progress.courseId !== courseId),
          )
          const remainingPrevious = Object.fromEntries(
            Object.entries(state.previousByLesson).filter(([, progress]) => progress.courseId !== courseId),
          )
          const keyPrefix = `${courseId}:`
          const remainingOperations = Object.fromEntries(
            Object.entries(state.archiveOperationByLesson).filter(([key]) => !key.startsWith(keyPrefix)),
          )
          return Object.keys(remaining).length === Object.keys(state.byLesson).length &&
            Object.keys(remainingPrevious).length === Object.keys(state.previousByLesson).length &&
            Object.keys(remainingOperations).length === Object.keys(state.archiveOperationByLesson).length
            ? state
            : {
                byLesson: remaining,
                previousByLesson: remainingPrevious,
                archiveOperationByLesson: remainingOperations,
              }
        })
      },
    }),
    {
      name: QUIZ_PROGRESS_STORAGE_KEY,
      storage: createJSONStorage(() => learningDataStorage),
      version: 3,
      migrate: (persisted) => {
        const state = persisted as Partial<QuizProgressState> | undefined
        return {
          byLesson: state?.byLesson ?? {},
          previousByLesson: state?.previousByLesson ?? {},
          archiveOperationByLesson: state?.archiveOperationByLesson ?? {},
        }
      },
      partialize: state => ({
        byLesson: state.byLesson,
        previousByLesson: state.previousByLesson,
        archiveOperationByLesson: state.archiveOperationByLesson,
      }),
    },
  ),
)
