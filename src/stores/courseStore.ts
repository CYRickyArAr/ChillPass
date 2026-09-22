import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { learningDataStorage } from '../services/learningDataStorage'
import { nanoid } from 'nanoid'
import { buildCourseArchive, restoreCourseFiles } from '../services/courseArchive'
import { createLessonPlan, parseLessonCount, recommendLessonCount } from '../services/lessonPlanning'
import type {
  Course,
  CourseFile,
  ExamPoint,
  Lesson,
  LessonContent,
  LessonOutputBudget,
  Progress,
  CourseBundle,
  CourseStatus,
  CoursePreparationProgress,
  CourseOptimizationKind,
  CourseOptimizationJob,
} from '@types/index'

const emptyProgress: Progress = {
  totalLessons: 0,
  completedLessons: 0,
  currentStreak: 0,
}

function createEmptyBundle(course: Course): CourseBundle {
  return {
    course,
    examPoints: [],
    lessons: [],
    progress: emptyProgress,
    rawText: '',
    preparationProgress: { stage: 'idle', current: 0, total: 0 },
    generatingLessons: false,
    generationPaused: false,
    generationProgress: { current: 0, total: 0 },
  }
}

interface CourseState {
  courses: CourseBundle[]
  currentCourseId: string | null

  // Actions
  rememberStudiedLesson: (courseId: string, lessonId: string) => void
  createCourse: (name: string) => string | null
  switchCourse: (id: string) => void
  renameCourse: (id: string, newName: string) => void
  moveCourse: (id: string, targetId: string, position: 'before' | 'after') => void
  deleteCourse: (id: string) => void
  setCourseStatus: (id: string, status: CourseStatus) => void
  setPreparationProgress: (id: string, progress: CoursePreparationProgress) => void
  addFiles: (files: CourseFile[]) => void
  setRawText: (text: string, courseId?: string) => void
  appendRawText: (text: string) => void
  setExamPoints: (points: ExamPoint[], courseId?: string) => void
  prepareLessonPlan: (points: ExamPoint[], courseId: string) => void
  setLessonPlanCount: (courseId: string, value: string) => void
  confirmLessonPlan: (courseId: string) => boolean
  rebuildLessonStructure: (courseId: string, points: ExamPoint[], count: number) => RebuildLessonStructureResult | null
  mergeExamPoints: (points: ExamPoint[], courseId?: string) => void
  generateLessons: (courseId?: string) => void
  setLessonContent: (lessonId: string, content: LessonContent, courseId?: string) => void
  setLessonGenerationError: (lessonId: string, error: string | undefined, courseId: string) => void
  setLessonGenerationBudget: (lessonId: string, budget: LessonOutputBudget, courseId: string) => void
  replaceLessonContent: (lessonId: string, content: LessonContent, courseId?: string) => void
  restorePreviousLessonContent: (lessonId: string, courseId?: string) => boolean
  setGeneratingLessons: (generating: boolean, progress?: { current: number; total: number }, courseId?: string) => void
  setGenerationPaused: (paused: boolean, courseId?: string) => void
  beginOptimization: (courseId: string, kind: CourseOptimizationKind, lessonId?: string, sourceFingerprint?: string) => string | null
  markOptimizationScanProcessing: (courseId: string, jobId: string) => void
  applyOptimizationScan: (courseId: string, jobId: string, points: ExamPoint[], scanFailed?: boolean) => void
  markOptimizationItemProcessing: (courseId: string, jobId: string, lessonId: string) => void
  commitOptimizedLesson: (courseId: string, jobId: string, lessonId: string, content: LessonContent) => boolean
  markOptimizationItemFailed: (courseId: string, jobId: string, lessonId: string, error: string) => void
  finishOptimization: (courseId: string, jobId: string) => void
  setOptimizationStatus: (courseId: string, jobId: string, status: CourseOptimizationJob['status'], error?: string) => void
  clearOptimization: (courseId: string) => void
  completeLesson: (lessonId: string) => void
  clearCompletedProgress: (courseId?: string) => void
  setExamDate: (date: string) => void
  resetCourse: () => void
  /** 批量更新文件路径（资源迁移后调用） */
  updateFilePaths: (pathMap: Record<string, string>) => void
  /** 导出课程为 JSON 文件 */
  exportCourse: (id: string) => Promise<void>
  /** 导入课程（返回是否成功） */
  importCourse: (data: CourseBundle) => Promise<boolean>
}

type LegacyLesson = Lesson & { coins?: number }
type LegacyProgress = Progress & { chillCoins?: number; totalStudyMinutes?: number }

/** 清理旧字段，并把刷新时中断的请求还原为可安全续跑的持久任务。 */
function stripLegacyGamification(bundle: CourseBundle): CourseBundle {
  const lessons = bundle.lessons.map(lesson => {
    const normalized = {
      ...lesson,
      status: lesson.status === 'locked' ? 'available' as const : lesson.status,
    } as LegacyLesson
    delete normalized.coins
    return normalized
  })
  const progress = { ...bundle.progress } as LegacyProgress
  delete progress.chillCoins
  delete progress.totalStudyMinutes
  const hasGeneratedStructure = bundle.examPoints.length > 0 && lessons.length > 0
  let status = bundle.course.status
  if (status === 'analyzing') status = hasGeneratedStructure ? 'ready' : 'uploaded'
  if (status === 'uploaded' && hasGeneratedStructure) status = 'ready'
  const savedPreparation = bundle.preparationProgress ?? { stage: 'idle' as const, current: 0, total: 0 }
  const preparationProgress: CoursePreparationProgress =
    savedPreparation.stage === 'parsing' ||
    savedPreparation.stage === 'extracting' ||
    savedPreparation.stage === 'building'
      ? { stage: 'idle', current: 0, total: savedPreparation.total }
      : savedPreparation

  const hasPendingContent = lessons.some(lesson => !lesson.content)
  const optimizationJob = bundle.optimizationJob
    ? {
        ...bundle.optimizationJob,
        scanState: bundle.optimizationJob.scanState === 'processing'
          ? 'pending' as const
          : bundle.optimizationJob.scanState,
        items: Object.fromEntries(
          Object.entries(bundle.optimizationJob.items ?? {}).map(([lessonId, item]) => [
            lessonId,
            item.state === 'processing' ? { ...item, state: 'pending' as const } : item,
          ]),
        ),
      }
    : undefined

  return {
    ...bundle,
    course: status === bundle.course.status ? bundle.course : { ...bundle.course, status },
    lessons,
    progress,
    preparationProgress,
    // Promise 本身不会跨刷新保留，但运行意图和进度保留，由 App 重新建立请求。
    generatingLessons: bundle.generatingLessons === true && hasPendingContent && bundle.generationPaused !== true,
    generationPaused: bundle.generationPaused === true,
    generationProgress: bundle.generationProgress ?? { current: 0, total: lessons.length },
    optimizationJob,
  }
}

function arePointTitlesSimilar(first: string, second: string): boolean {
  const normalize = (title: string) => title
    .toLowerCase()
    .replace(/[\s（）()【】\[\]“”"'：:，,。.!！？?、]/g, '')
  const a = normalize(first)
  const b = normalize(second)
  if (!a || !b) return false
  if (a === b || (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a)))) return true

  const aChars = new Set(a)
  const bChars = new Set(b)
  let common = 0
  for (const char of aChars) if (bChars.has(char)) common++
  return common / Math.min(aChars.size, bChars.size) > 0.7
}

/** 更新当前课程的辅助函数 */
function updateCurrentBundle(state: CourseState, updater: (bundle: CourseBundle) => CourseBundle): Partial<CourseState> {
  if (!state.currentCourseId) return {}
  return {
    courses: state.courses.map(b =>
      b.course.id === state.currentCourseId ? updater(b) : b
    )
  }
}

/** 按课程 ID 更新，避免后台任务期间切换课程后写错目标。 */
function updateBundleById(state: CourseState, id: string, updater: (bundle: CourseBundle) => CourseBundle): Partial<CourseState> {
  return {
    courses: state.courses.map(bundle => bundle.course.id === id ? updater(bundle) : bundle),
  }
}

/**
 * 只把真正缺失的考点并入课程。已有考点、关卡内容、完成状态以及旧关卡相对顺序均保留。
 */
function mergeNewExamPointsIntoBundle(
  bundle: CourseBundle,
  newPoints: ExamPoint[],
): { bundle: CourseBundle; addedExamPointIds: string[] } {
  const trulyNewPoints: ExamPoint[] = []
  for (const point of newPoints) {
    const knownPoints = [...bundle.examPoints, ...trulyNewPoints].flatMap(existing => [existing, ...(existing.coveredPoints ?? [])])
    if (!knownPoints.some(existing => arePointTitlesSimilar(existing.title, point.title))) {
      trulyNewPoints.push(point)
    }
  }

  if (trulyNewPoints.length === 0) {
    return {
      bundle: {
        ...bundle,
        course: { ...bundle.course, status: 'ready', updatedAt: Date.now() },
      },
      addedExamPointIds: [],
    }
  }

  // 新考点一律追加在末尾，不按优先级重排：学习顺序要服从先修关系，
  // 把“必考”整体提前会把依赖基础概念的内容排到基础之前。
  const mergedPoints = [...bundle.examPoints, ...trulyNewPoints]
  const newLessons: Lesson[] = trulyNewPoints.map(point => ({
    id: nanoid(),
    courseId: bundle.course.id,
    order: 0,
    title: point.title,
    examPointId: point.id,
    priority: point.priority,
    status: 'available',
    sourceFile: point.sourceFile,
    chapterTitle: point.chapterTitle,
  }))
  const orderedLessons = [...bundle.lessons, ...newLessons]
    .map((lesson, index) => ({
      ...lesson,
      order: index + 1,
      status: lesson.status === 'completed' ? 'completed' as const : 'available' as const,
    }))

  return {
    bundle: {
      ...bundle,
      course: { ...bundle.course, status: 'ready', updatedAt: Date.now() },
      examPoints: mergedPoints,
      lessons: orderedLessons,
      progress: { ...bundle.progress, totalLessons: orderedLessons.length },
    },
    addedExamPointIds: trulyNewPoints.map(point => point.id),
  }
}

interface RebuildLessonStructureResult {
  before: number
  after: number
  reused: number
  pending: number
}

function pointTitleCandidates(point?: ExamPoint): string[] {
  if (!point) return []
  return [
    point.title,
    ...(point.coveredPoints ?? []).map(covered => covered.title),
  ].filter(Boolean)
}

function findReusableLesson(
  point: ExamPoint,
  oldLessons: Lesson[],
  oldPoints: ExamPoint[],
  usedLessonIds: Set<string>,
): Lesson | undefined {
  const targetTitles = pointTitleCandidates(point)
  for (const lesson of oldLessons) {
    if (usedLessonIds.has(lesson.id)) continue
    const oldPoint = oldPoints.find(candidate => candidate.id === lesson.examPointId)
    const oldTitles = [lesson.title, ...pointTitleCandidates(oldPoint)]
    if (targetTitles.some(target => oldTitles.some(existing => arePointTitlesSimilar(target, existing)))) {
      usedLessonIds.add(lesson.id)
      return lesson
    }
  }
  return undefined
}

function rebuildLessonStructureInBundle(
  bundle: CourseBundle,
  extractedPoints: ExamPoint[],
  count: number,
): { bundle: CourseBundle; result: RebuildLessonStructureResult } {
  const before = bundle.lessons.length
  const points = createLessonPlan(extractedPoints, count)
  const usedLessonIds = new Set<string>()
  let reused = 0

  const lessons: Lesson[] = points.map((point, index) => {
    const reusable = findReusableLesson(point, bundle.lessons, bundle.examPoints, usedLessonIds)
    if (reusable?.content) reused += 1
    return {
      id: reusable?.id ?? nanoid(),
      courseId: bundle.course.id,
      order: index + 1,
      title: point.title,
      examPointId: point.id,
      priority: point.priority,
      status: reusable?.content ? reusable.status : 'available',
      sourceFile: point.sourceFile,
      chapterTitle: point.chapterTitle,
      content: reusable?.content,
      previousContent: reusable?.previousContent,
      contentUpdatedAt: reusable?.contentUpdatedAt,
      completedAt: reusable?.content ? reusable.completedAt : undefined,
      generationError: undefined,
      generationBudget: reusable?.generationBudget,
    }
  })

  const completedLessons = lessons.filter(lesson => lesson.status === 'completed').length
  const pending = lessons.filter(lesson => !lesson.content).length
  return {
    result: { before, after: lessons.length, reused, pending },
    bundle: {
      ...bundle,
      course: { ...bundle.course, status: 'ready', updatedAt: Date.now() },
      examPoints: points,
      lessons,
      lessonPlan: { sourcePointCount: extractedPoints.length, targetCount: count, createdAt: Date.now() },
      lessonPlanDraft: undefined,
      optimizationJob: undefined,
      generatingLessons: false,
      generationPaused: pending > 0,
      generationProgress: { current: lessons.length - pending, total: lessons.length },
      preparationProgress: { stage: 'idle', current: 0, total: 0 },
      progress: {
        ...bundle.progress,
        totalLessons: lessons.length,
        completedLessons,
      },
    },
  }
}

export const useCourseStore = create<CourseState>()(
  persist(
    (set, get) => ({
      courses: [],
      currentCourseId: null,

      createCourse: (name) => {
        const trimmedName = name.trim()
        if (!trimmedName) return null

        // 课程管理系统：禁止同名课程
        const existing = get().courses.find(b => b.course.name === trimmedName)
        if (existing) {
          // 已存在同名课程，切换到该课程并返回 null 表示未创建
          set({ currentCourseId: existing.course.id })
          return null
        }

        const id = nanoid()
        const course: Course = {
          id,
          name: trimmedName,
          files: [],
          status: 'empty',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        set(state => ({
          courses: [...state.courses, createEmptyBundle(course)],
          currentCourseId: id,
        }))
        return id
      },

      switchCourse: (id) => {
        set({ currentCourseId: id })
      },

      renameCourse: (id, newName) => {
        const name = newName.trim()
        if (!name) return
        // 检查是否与其他课程同名
        const duplicate = get().courses.find(b => b.course.id !== id && b.course.name === name)
        if (duplicate) return
        set(state => ({
          courses: state.courses.map(bundle =>
            bundle.course.id === id
              ? { ...bundle, course: { ...bundle.course, name } }
              : bundle
          ),
        }))
      },

      moveCourse: (id, targetId, position) => {
        set(state => {
          const index = state.courses.findIndex(bundle => bundle.course.id === id)
          const targetIndex = state.courses.findIndex(bundle => bundle.course.id === targetId)
          if (index === -1 || targetIndex === -1 || id === targetId) return {}

          const courses = [...state.courses]
          const [moved] = courses.splice(index, 1)
          const nextTargetIndex = courses.findIndex(bundle => bundle.course.id === targetId)
          if (nextTargetIndex === -1) return {}
          const insertIndex = position === 'before' ? nextTargetIndex : nextTargetIndex + 1
          courses.splice(insertIndex, 0, moved)
          return { courses }
        })
      },

      deleteCourse: (id) => {
        set(state => {
          const courses = state.courses.filter(b => b.course.id !== id)
          const currentCourseId = state.currentCourseId === id
            ? (courses[0]?.course.id ?? null)
            : state.currentCourseId
          return { courses, currentCourseId }
        })
      },

      setCourseStatus: (id, status) => {
        set(state => updateBundleById(state, id, bundle => ({
          ...bundle,
          course: { ...bundle.course, status, updatedAt: Date.now() },
        })))
      },

      setPreparationProgress: (id, preparationProgress) => {
        set(state => updateBundleById(state, id, bundle => ({
          ...bundle,
          preparationProgress,
        })))
      },

      addFiles: (files) => {
        set(state => updateCurrentBundle(state, bundle => ({
          ...bundle,
          course: {
            ...bundle.course,
            files: [...bundle.course.files.filter(old => !(old.path.startsWith('missing:') && files.some(f => f.name === old.name && f.size === old.size))), ...files],
            status: bundle.course.status === 'empty' ? 'uploaded' : bundle.course.status,
            updatedAt: Date.now(),
          }
        })))
      },

      rememberStudiedLesson: (courseId, lessonId) => {
        const bundle = get().courses.find(item => item.course.id === courseId)
        if (!bundle || bundle.lastStudiedLessonId === lessonId ||
          !bundle.lessons.some(lesson => lesson.id === lessonId && lesson.content)) return
        set(state => updateBundleById(state, courseId, current => ({
          ...current, lastStudiedLessonId: lessonId,
        })))
      },

      setRawText: (text, requestedCourseId) => {
        const courseId = requestedCourseId ?? get().currentCourseId
        if (!courseId) return
        set(state => updateBundleById(state, courseId, bundle => ({
          ...bundle,
          course: {
            ...bundle.course,
            status: bundle.course.status === 'empty' ? 'uploaded' : bundle.course.status,
            updatedAt: Date.now(),
          },
          rawText: text,
        })))
      },

      appendRawText: (text) => {
        set(state => updateCurrentBundle(state, bundle => ({
          ...bundle,
          course: { ...bundle.course, updatedAt: Date.now() },
          rawText: bundle.rawText + '\n\n' + text,
        })))
      },

      prepareLessonPlan: (points, courseId) => {
        if (!points.length) return
        set(state => updateBundleById(state, courseId, bundle => {
          // Choosing a new course's size must never replace existing lessons or study records.
          if (bundle.lessons.length > 0 || bundle.generatingLessons) return bundle
          return {
            ...bundle,
            course: { ...bundle.course, status: 'uploaded', updatedAt: Date.now() },
            lessonPlanDraft: { points, countInput: String(recommendLessonCount(points).suggested), createdAt: Date.now() },
            preparationProgress: { stage: 'idle', current: 0, total: 0 },
          }
        }))
      },

      setLessonPlanCount: (courseId, countInput) => {
        set(state => updateBundleById(state, courseId, bundle => bundle.lessonPlanDraft
          ? { ...bundle, lessonPlanDraft: { ...bundle.lessonPlanDraft, countInput } }
          : bundle))
      },

      confirmLessonPlan: (courseId) => {
        const bundle = get().courses.find(item => item.course.id === courseId)
        const draft = bundle?.lessonPlanDraft
        const count = draft ? parseLessonCount(draft.countInput) : null
        if (!bundle || !draft || !count || bundle.lessons.length || bundle.generatingLessons) return false
        const points = createLessonPlan(draft.points, count)
        const lessons: Lesson[] = points.map((point, index) => ({
          id: nanoid(), courseId, order: index + 1, title: point.title,
          examPointId: point.id, priority: point.priority, status: 'available', sourceFile: point.sourceFile, chapterTitle: point.chapterTitle,
        }))
        set(state => updateBundleById(state, courseId, current => ({
          ...current,
          course: { ...current.course, status: 'ready', updatedAt: Date.now() },
          examPoints: points, lessons,
          lessonPlan: { sourcePointCount: draft.points.length, targetCount: count, createdAt: Date.now() },
          lessonPlanDraft: undefined,
          progress: { ...emptyProgress, totalLessons: lessons.length },
          // Persist intent before launching the first request, so a refresh can resume safely.
          generatingLessons: true, generationPaused: false, generationProgress: { current: 0, total: count },
        })))
        return true
      },

      rebuildLessonStructure: (courseId, points, count) => {
        const bundle = get().courses.find(item => item.course.id === courseId)
        if (!bundle || !points.length || !Number.isSafeInteger(count) || count <= 0 || bundle.generatingLessons) return null
        const rebuilt = rebuildLessonStructureInBundle(bundle, points, count)
        set(state => updateBundleById(state, courseId, () => rebuilt.bundle))
        return rebuilt.result
      },

      setExamPoints: (points, requestedCourseId) => {
        const courseId = requestedCourseId ?? get().currentCourseId
        if (!courseId) return
        set(state => {
          const updatedCourses = state.courses.map(bundle => bundle.course.id === courseId
            ? {
                ...bundle,
                course: { ...bundle.course, status: 'ready' as const, updatedAt: Date.now() },
                examPoints: points,
                preparationProgress: { stage: 'idle' as const, current: 0, total: 0 },
              }
            : bundle)
          // 课程变为 ready 后，清理同名/同内容的旧重复课程（非 ready 状态）
          const currentName = updatedCourses.find(b => b.course.id === courseId)?.course.name
          const courses = currentName
            ? updatedCourses.filter(b =>
                b.course.id === courseId ||
                b.course.status === 'ready' ||
                b.course.name !== currentName
              )
            : updatedCourses
          return { courses }
        })
        get().generateLessons(courseId)
      },

      mergeExamPoints: (newPoints, requestedCourseId) => {
        const state = get()
        const courseId = requestedCourseId ?? state.currentCourseId
        if (!courseId) return
        set(s => updateBundleById(s, courseId, bundle =>
          mergeNewExamPointsIntoBundle(bundle, newPoints).bundle
        ))
      },

      generateLessons: (requestedCourseId) => {
        const state = get()
        const courseId = requestedCourseId ?? state.currentCourseId
        if (!courseId) return
        const bundle = state.courses.find(b => b.course.id === courseId)
        if (!bundle || bundle.examPoints.length === 0) return

        // 直接沿用考点自身的先修顺序，不按优先级重排，避免把前置知识排到后面。
        const lessons: Lesson[] = bundle.examPoints.map((point, index) => ({
          id: nanoid(),
          courseId: bundle.course.id,
          order: index + 1,
          title: point.title,
          examPointId: point.id,
          priority: point.priority,
          status: 'available',
          sourceFile: point.sourceFile,
          chapterTitle: point.chapterTitle,
        }))

        set(s => updateBundleById(s, courseId, b => ({
          ...b,
          lessons,
          progress: {
            totalLessons: lessons.length,
            completedLessons: 0,
            currentStreak: 0,
          },
        })))
      },

      setLessonContent: (lessonId, content, requestedCourseId) => {
        const courseId = requestedCourseId ?? get().currentCourseId
        if (!courseId) return
        set(state => updateBundleById(state, courseId, bundle => ({
          ...bundle,
          lessons: bundle.lessons.map(l => {
            if (l.id !== lessonId) return l
            const next = { ...l, content }
            delete next.generationError
            return next
          }),
        })))
      },

      setGeneratingLessons: (generating, progress, requestedCourseId) => {
        const courseId = requestedCourseId ?? get().currentCourseId
        if (!courseId) return
        set(state => updateBundleById(state, courseId, bundle => ({
          ...bundle,
          generatingLessons: generating,
          generationProgress: progress ?? bundle.generationProgress,
        })))
      },

      completeLesson: (lessonId) => {
        set(state => updateCurrentBundle(state, bundle => {
          const lesson = bundle.lessons.find(l => l.id === lessonId)
          if (!lesson || lesson.status === 'completed') return bundle

          const updatedLessons = bundle.lessons.map(l => {
            if (l.id === lessonId) {
              return { ...l, status: 'completed' as const, completedAt: Date.now() }
            }
            return l
          })

          return {
            ...bundle,
            lessons: updatedLessons,
            progress: {
              ...bundle.progress,
              completedLessons: bundle.progress.completedLessons + 1,
            },
          }
        }))
      },

      clearCompletedProgress: (requestedCourseId) => {
        const courseId = requestedCourseId ?? get().currentCourseId
        if (!courseId) return
        set(state => updateBundleById(state, courseId, bundle => {
          if (!bundle.lessons.some(lesson => lesson.status === 'completed')) return bundle
          return {
            ...bundle,
            lessons: bundle.lessons.map(lesson => {
              if (lesson.status !== 'completed') return lesson
              const next = {
                ...lesson,
                status: 'available' as const,
              }
              delete next.completedAt
              return next
            }),
            progress: {
              ...bundle.progress,
              completedLessons: 0,
              currentStreak: 0,
            },
          }
        }))
      },

      setLessonGenerationBudget: (lessonId, budget, courseId) => {
        if (!Number.isFinite(budget.maxTokens) || budget.maxTokens <= 0) return
        set(state => updateBundleById(state, courseId, bundle => ({
          ...bundle,
          lessons: bundle.lessons.map(lesson => lesson.id === lessonId
            ? { ...lesson, generationBudget: { key: budget.key, maxTokens: Math.floor(budget.maxTokens) } }
            : lesson),
        })))
      },

      setLessonGenerationError: (lessonId, error, courseId) => {
        set(state => updateBundleById(state, courseId, bundle => ({
          ...bundle,
          lessons: bundle.lessons.map(lesson => {
            if (lesson.id !== lessonId || lesson.content) return lesson
            const next = { ...lesson }
            if (error) next.generationError = error
            else delete next.generationError
            return next
          }),
        })))
      },

      setGenerationPaused: (paused, requestedCourseId) => {
        const courseId = requestedCourseId ?? get().currentCourseId
        if (!courseId) return
        set(state => updateBundleById(state, courseId, bundle => ({
          ...bundle,
          generationPaused: paused,
        })))
      },

      beginOptimization: (courseId, kind, lessonId, sourceFingerprint = '') => {
        let jobId: string | null = null
        set(state => updateBundleById(state, courseId, bundle => {
          const existing = bundle.optimizationJob
          if (existing && (existing.status === 'running' || existing.status === 'paused')) {
            jobId = existing.id
            return bundle
          }

          const targetLesson = kind === 'single'
            ? bundle.lessons.find(lesson => lesson.id === lessonId)
            : undefined
          if (kind === 'single' && !targetLesson) return bundle

          const id = nanoid()
          const now = Date.now()
          const targetLessonIds = targetLesson ? [targetLesson.id] : []
          const items = targetLesson
            ? {
                [targetLesson.id]: {
                  lessonId: targetLesson.id,
                  state: 'pending' as const,
                  attempts: 0,
                  hadContentAtStart: Boolean(targetLesson.content),
                },
              }
            : {}
          jobId = id
          return {
            ...bundle,
            optimizationJob: {
              schemaVersion: 1,
              id,
              kind,
              status: 'running',
              phase: kind === 'batch' ? 'scanning' : 'optimizing',
              scanState: kind === 'batch' ? 'pending' : 'skipped',
              sourceFingerprint,
              targetLessonIds,
              items,
              addedExamPointIds: [],
              scanFailed: false,
              startedAt: now,
              updatedAt: now,
            },
          }
        }))
        return jobId
      },

      markOptimizationScanProcessing: (courseId, jobId) => {
        set(state => updateBundleById(state, courseId, bundle => {
          const job = bundle.optimizationJob
          if (!job || job.id !== jobId || job.status !== 'running' || job.phase !== 'scanning') return bundle
          return {
            ...bundle,
            optimizationJob: { ...job, scanState: 'processing', updatedAt: Date.now() },
          }
        }))
      },

      applyOptimizationScan: (courseId, jobId, points, scanFailed = false) => {
        set(state => updateBundleById(state, courseId, bundle => {
          const job = bundle.optimizationJob
          if (!job || job.id !== jobId || job.status !== 'running' || job.phase !== 'scanning') return bundle
          if (job.scanState === 'applied' || job.scanState === 'failed') return bundle

          const merged = mergeNewExamPointsIntoBundle(bundle, points)
          const targetLessons = [...merged.bundle.lessons].sort((a, b) => a.order - b.order)
          const items = Object.fromEntries(targetLessons.map(lesson => [
            lesson.id,
            {
              lessonId: lesson.id,
              state: 'pending' as const,
              attempts: 0,
              hadContentAtStart: Boolean(lesson.content),
            },
          ]))

          return {
            ...merged.bundle,
            optimizationJob: {
              ...job,
              phase: 'optimizing',
              scanState: scanFailed ? 'failed' : 'applied',
              targetLessonIds: targetLessons.map(lesson => lesson.id),
              items,
              addedExamPointIds: merged.addedExamPointIds,
              scanFailed,
              updatedAt: Date.now(),
            },
          }
        }))
      },

      markOptimizationItemProcessing: (courseId, jobId, lessonId) => {
        set(state => updateBundleById(state, courseId, bundle => {
          const job = bundle.optimizationJob
          const item = job?.items[lessonId]
          if (!job || job.id !== jobId || job.status !== 'running' || !item || item.state === 'done') return bundle
          return {
            ...bundle,
            optimizationJob: {
              ...job,
              items: {
                ...job.items,
                [lessonId]: { ...item, state: 'processing', attempts: item.attempts + 1, error: undefined },
              },
              updatedAt: Date.now(),
            },
          }
        }))
      },

      commitOptimizedLesson: (courseId, jobId, lessonId, content) => {
        let committed = false
        set(state => updateBundleById(state, courseId, bundle => {
          const job = bundle.optimizationJob
          const item = job?.items[lessonId]
          const lesson = bundle.lessons.find(candidate => candidate.id === lessonId)
          if (!job || job.id !== jobId || job.status !== 'running' || !item || item.state === 'done' || !lesson) {
            return bundle
          }

          committed = true
          return {
            ...bundle,
            lessons: bundle.lessons.map(candidate => candidate.id === lessonId
              ? {
                  ...candidate,
                  content,
                  previousContent: candidate.content ?? candidate.previousContent,
                  contentUpdatedAt: Date.now(),
                }
              : candidate),
            optimizationJob: {
              ...job,
              items: {
                ...job.items,
                [lessonId]: { ...item, state: 'done', error: undefined },
              },
              updatedAt: Date.now(),
            },
          }
        }))
        return committed
      },

      markOptimizationItemFailed: (courseId, jobId, lessonId, error) => {
        set(state => updateBundleById(state, courseId, bundle => {
          const job = bundle.optimizationJob
          const item = job?.items[lessonId]
          if (!job || job.id !== jobId || job.status !== 'running' || !item || item.state === 'done') return bundle
          return {
            ...bundle,
            optimizationJob: {
              ...job,
              items: { ...job.items, [lessonId]: { ...item, state: 'failed', error } },
              updatedAt: Date.now(),
            },
          }
        }))
      },

      finishOptimization: (courseId, jobId) => {
        set(state => updateBundleById(state, courseId, bundle => {
          const job = bundle.optimizationJob
          if (!job || job.id !== jobId || job.status !== 'running') return bundle
          const items = Object.values(job.items)
          const now = Date.now()
          return {
            ...bundle,
            optimizationJob: {
              ...job,
              status: 'completed',
              summary: {
                added: job.addedExamPointIds.length,
                success: items.filter(item => item.state === 'done').length,
                failed: items.filter(item => item.state === 'failed').length,
              },
              completedAt: now,
              updatedAt: now,
            },
          }
        }))
      },

      setOptimizationStatus: (courseId, jobId, status, error) => {
        set(state => updateBundleById(state, courseId, bundle => {
          const job = bundle.optimizationJob
          if (!job || job.id !== jobId) return bundle
          const resetForResume = status === 'running'
          const items = resetForResume
            ? Object.fromEntries(Object.entries(job.items).map(([id, item]) => [
                id,
                item.state === 'processing' ? { ...item, state: 'pending' as const } : item,
              ]))
            : job.items
          return {
            ...bundle,
            optimizationJob: {
              ...job,
              status,
              scanState: resetForResume && job.scanState === 'processing' ? 'pending' : job.scanState,
              items,
              error,
              updatedAt: Date.now(),
              ...(status === 'cancelled' ? { completedAt: Date.now() } : {}),
            },
          }
        }))
      },

      clearOptimization: (courseId) => {
        set(state => updateBundleById(state, courseId, bundle => ({
          ...bundle,
          optimizationJob: undefined,
        })))
      },

      /**
       * 完整替换关卡内容时保留最近一版。关卡 id、完成状态和课程进度均不变；
       * 只有 AI 已成功返回新内容后才应调用本动作。
       */
      replaceLessonContent: (lessonId, content, requestedCourseId) => {
        const courseId = requestedCourseId ?? get().currentCourseId
        if (!courseId) return
        set(state => updateBundleById(state, courseId, bundle => ({
          ...bundle,
          lessons: bundle.lessons.map(lesson =>
            lesson.id === lessonId
              ? {
                  ...lesson,
                  content,
                  previousContent: lesson.content,
                  contentUpdatedAt: Date.now(),
                }
              : lesson
          ),
        })))
      },

      /** 恢复最近一版内容，并与当前版本互换，允许用户再次撤销恢复。 */
      restorePreviousLessonContent: (lessonId, requestedCourseId) => {
        const courseId = requestedCourseId ?? get().currentCourseId
        if (!courseId) return false
        let restored = false
        set(state => updateBundleById(state, courseId, bundle => ({
          ...bundle,
          lessons: bundle.lessons.map(lesson => {
            if (lesson.id !== lessonId || !lesson.previousContent) return lesson
            restored = true
            return {
              ...lesson,
              content: lesson.previousContent,
              previousContent: lesson.content,
              contentUpdatedAt: Date.now(),
            }
          }),
        })))
        return restored
      },

      setExamDate: (date) => {
        set(state => updateCurrentBundle(state, bundle => ({
          ...bundle,
          course: { ...bundle.course, examDate: date, updatedAt: Date.now() },
        })))
      },

      resetCourse: () => {
        set(state => updateCurrentBundle(state, bundle => createEmptyBundle({
          ...bundle.course,
          files: [],
          status: 'empty',
          examDate: undefined,
          updatedAt: Date.now(),
        })))
      },

      updateFilePaths: (pathMap) => {
        set(state => ({
          courses: state.courses.map(bundle => ({
            ...bundle,
            course: {
              ...bundle.course,
              files: bundle.course.files.map(f => {
                const newPath = pathMap[f.path]
                return newPath ? { ...f, path: newPath } : f
              }),
            },
          })),
        }))
      },

      exportCourse: async (id) => {
        const bundle = get().courses.find(b => b.course.id === id)
        if (!bundle) return

        // 运行任务属于本机瞬时执行意图，不随课程包导出到另一台设备。
        const exportableBundle = await buildCourseArchive(bundle)
        const json = JSON.stringify(exportableBundle, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)

        const date = new Date()
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        const fileName = `ChillPass-${bundle.course.name}-${dateStr}.json`

        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      },

      importCourse: async (data) => {
        // 验证数据格式
        if (!data || typeof data !== 'object') return false
        if (!data.course || !Array.isArray(data.examPoints) || !Array.isArray(data.lessons)) {
          return false
        }

        // 课程管理系统：基于内容检测重复课程
        // 比较考点标题集合，如果重叠率超过 80% 则判定为同一门课程
        const incomingPointTitles = new Set(data.examPoints.map(p => p.title))
        const existingDuplicate = get().courses.find(b => {
          if (b.course.name === data.course.name) return true
          if (b.examPoints.length === 0 || incomingPointTitles.size === 0) return false
          const existingTitles = new Set(b.examPoints.map(p => p.title))
          let overlap = 0
          for (const t of incomingPointTitles) {
            if (existingTitles.has(t)) overlap++
          }
          const overlapRate = overlap / Math.max(incomingPointTitles.size, existingTitles.size)
          return overlapRate > 0.8
        })

        if (existingDuplicate) {
          // 已存在相同课程，直接切换到该课程，不重复导入
          set({ currentCourseId: existingDuplicate.course.id })
          return false
        }

        const normalizedData = stripLegacyGamification(await restoreCourseFiles(data))
        const newCourseId = nanoid()

        // 为考点生成新 ID，并建立 旧ID -> 新ID 映射
        const examPointIdMap: Record<string, string> = {}
        const newExamPoints: ExamPoint[] = normalizedData.examPoints.map(p => {
          const newId = nanoid()
          examPointIdMap[p.id] = newId
          return { ...p, id: newId }
        })

        // 为关卡生成新 ID，同时更新 courseId 与 examPointId
        // 保留所有已生成的关卡内容（content 字段）
        const newLessons: Lesson[] = normalizedData.lessons.map(l => ({
          ...l,
          id: nanoid(),
          courseId: newCourseId,
          examPointId: examPointIdMap[l.examPointId] ?? l.examPointId,
        }))

        const newBundle: CourseBundle = {
          ...normalizedData,
          course: {
            ...normalizedData.course,
            id: newCourseId,
            status: 'ready',
            updatedAt: Date.now(),
          },
          examPoints: newExamPoints,
          lessons: newLessons,
          // 重置后台生成状态（内容已在导出数据中）
          generatingLessons: false,
          generationPaused: false,
          generationProgress: { current: 0, total: 0 },
          optimizationJob: undefined,
        }

        set(state => ({
          courses: [...state.courses, newBundle],
          currentCourseId: newCourseId,
        }))

        return true
      },
    }),
    {
      name: 'chillpass-course-v2',
      storage: createJSONStorage(() => learningDataStorage),
      version: 2,
      migrate: (persisted) => {
        const saved = (persisted ?? {}) as Partial<CourseState>
        return {
          ...saved,
          courses: (saved.courses ?? []).map(bundle => ({
            ...bundle,
            preparationProgress: bundle.preparationProgress ?? { stage: 'idle', current: 0, total: 0 },
            generationPaused: bundle.generationPaused === true,
            generationProgress: bundle.generationProgress ?? { current: 0, total: bundle.lessons?.length ?? 0 },
            optimizationJob: bundle.optimizationJob,
          })),
        } as CourseState
      },
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<CourseState>
        return {
          ...current,
          ...saved,
          courses: (saved.courses ?? current.courses).map(stripLegacyGamification),
        }
      },
    }
  )
)

/** 获取当前课程数据包的 hook 辅助函数 */
export function useCurrentBundle(): CourseBundle | null {
  return useCourseStore(s => {
    if (!s.currentCourseId) return null
    return s.courses.find(b => b.course.id === s.currentCourseId) ?? null
  })
}
