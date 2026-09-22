import { extractExamPointsFromSources, generateLessonContent } from './deepseek'
import { generateAllLessonsInBackground } from './lessonGenerator'
import { useCourseStore } from '@stores/courseStore'
import { invalidateQuizLessonRequests, useQuizProgressStore } from '@stores/quizProgressStore'
import { BACKGROUND_CONCURRENCY } from './aiScheduling'
import { recommendLessonCount } from './lessonPlanning'

const activeOptimizationRuns = new Map<string, AbortController>()

function getCourseBundle(courseId: string) {
  return useCourseStore.getState().courses.find(bundle => bundle.course.id === courseId)
}

function sourceFingerprint(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += Math.max(1, Math.floor(text.length / 4096))) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`
}

/** 从持久化课件文本中恢复文件边界；旧课程没有边界时按单一来源扫描。 */
function splitStoredCourseText(rawText: string, fallbackSource: string) {
  const markers = Array.from(rawText.matchAll(/===== 来源文件：(.+?) =====\r?\n/g))
  if (markers.length === 0) {
    return rawText.trim() ? [{ sourceFile: fallbackSource, text: rawText }] : []
  }

  return markers.flatMap((marker, index) => {
    const start = (marker.index ?? 0) + marker[0].length
    const end = markers[index + 1]?.index ?? rawText.length
    const text = rawText.slice(start, end).trim()
    const sourceFile = marker[1]?.trim() || fallbackSource
    return text ? [{ sourceFile, text }] : []
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isCurrentRunningJob(courseId: string, jobId: string): boolean {
  const job = getCourseBundle(courseId)?.optimizationJob
  return job?.id === jobId && job.status === 'running'
}

function isCurrentSourceVersion(courseId: string, jobId: string): boolean {
  const bundle = getCourseBundle(courseId)
  const job = bundle?.optimizationJob
  if (!bundle || !job || job.id !== jobId || job.status !== 'running') return false
  if (!job.sourceFingerprint || sourceFingerprint(bundle.rawText) === job.sourceFingerprint) return true

  useCourseStore.getState().setOptimizationStatus(
    courseId,
    jobId,
    'failed',
    '优化期间课件内容发生了变化，请重新开始本次优化。',
  )
  return false
}

async function runCourseOptimization(courseId: string, jobId: string): Promise<void> {
  if (activeOptimizationRuns.has(jobId)) return
  const controller = new AbortController()
  activeOptimizationRuns.set(jobId, controller)

  try {
    let bundle = getCourseBundle(courseId)
    let job = bundle?.optimizationJob
    if (!bundle || !job || job.id !== jobId || job.status !== 'running') return
    if (!isCurrentSourceVersion(courseId, jobId)) return

    if (job.kind === 'batch' && job.phase === 'scanning') {
      useCourseStore.getState().markOptimizationScanProcessing(courseId, jobId)
      try {
        const fallbackSource = bundle.course.files.length === 1
          ? bundle.course.files[0].name
          : `${bundle.course.name}（原课件）`
        const sources = splitStoredCourseText(bundle.rawText, fallbackSource)
        const discoveredPoints = sources.length > 0
          ? await extractExamPointsFromSources(sources, bundle.course.name, controller.signal)
          : []
        if (!isCurrentRunningJob(courseId, jobId)) return
        if (!isCurrentSourceVersion(courseId, jobId)) return
        useCourseStore.getState().applyOptimizationScan(courseId, jobId, discoveredPoints, false)
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error) || !isCurrentRunningJob(courseId, jobId)) return
        if (!isCurrentSourceVersion(courseId, jobId)) return
        console.error(`[CourseOptimizer] Failed to scan missing points for course ${courseId}:`, error)
        // 扫描失败不破坏旧结构，仍继续优化已有内容。
        useCourseStore.getState().applyOptimizationScan(courseId, jobId, [], true)
      }
    }

    const runWorker = async () => {
      while (!controller.signal.aborted) {
        const bundle = getCourseBundle(courseId)
        const job = bundle?.optimizationJob
        if (!bundle || !job || job.id !== jobId || job.status !== 'running') return
        if (!isCurrentSourceVersion(courseId, jobId)) return
        if (job.phase !== 'optimizing') return

        const lessonId = job.targetLessonIds.find(id => job?.items[id]?.state === 'pending')
        if (!lessonId) {
          return
        }

        const lesson = bundle.lessons.find(candidate => candidate.id === lessonId)
        const examPoint = lesson
          ? bundle.examPoints.find(point => point.id === lesson.examPointId)
          : undefined
        useCourseStore.getState().markOptimizationItemProcessing(courseId, jobId, lessonId)

        if (!lesson || !examPoint) {
          useCourseStore.getState().markOptimizationItemFailed(
            courseId,
            jobId,
            lessonId,
            '找不到关卡对应的知识点',
          )
          continue
        }

        // 关卡一旦进入整体替换，旧题正在执行的判分/复核响应不得再写回。
        invalidateQuizLessonRequests(courseId, lessonId)

        try {
          const recentQuestions = bundle.lessons.filter(item => item.id !== lessonId && item.content).slice(-4)
            .flatMap(item => (item.content!.quiz ?? []).map(question => question.question)).slice(-12)
          // 同一批优化里，按关卡顺序收集前面已讲过的知识点，避免重复解释前置概念。
          const priorKeyPoints = bundle.lessons
            .filter(item => item.id !== lessonId && item.order < lesson.order && item.content?.keyPoints?.length)
            .sort((a, b) => a.order - b.order)
            .flatMap(item => item.content!.keyPoints)
            .slice(-24)
          const content = await generateLessonContent(examPoint, bundle.rawText, controller.signal, bundle.course.name, recentQuestions, {
            savedBudget: lesson.generationBudget,
            previousError: lesson.generationError,
            onBudgetChange: budget => {
              if (controller.signal.aborted || !isCurrentRunningJob(courseId, jobId) || !isCurrentSourceVersion(courseId, jobId)) {
                throw new DOMException('Optimization context changed', 'AbortError')
              }
              useCourseStore.getState().setLessonGenerationBudget(lessonId, budget, courseId)
            },
          }, priorKeyPoints)
          if (controller.signal.aborted || !isCurrentRunningJob(courseId, jobId)) return
          if (!isCurrentSourceVersion(courseId, jobId)) return

          if (lesson.content) {
            useQuizProgressStore.getState().archiveLessonOnce(
              courseId,
              lessonId,
              `${jobId}:${lessonId}`,
            )
          }
          useCourseStore.getState().commitOptimizedLesson(courseId, jobId, lessonId, content)
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error) || !isCurrentRunningJob(courseId, jobId)) return
          const message = error instanceof Error ? error.message : '关卡内容生成失败'
          console.error(`[CourseOptimizer] Failed to optimize lesson ${lessonId}:`, error)
          useCourseStore.getState().markOptimizationItemFailed(courseId, jobId, lessonId, message)
        }
      }
    }
    const settled = await Promise.allSettled(Array.from({ length: BACKGROUND_CONCURRENCY }, () => runWorker().catch(error => {
      controller.abort()
      throw error
    })))
    const rejected = settled.find(result => result.status === 'rejected')
    if (rejected?.status === 'rejected') throw rejected.reason
    // Only the coordinator may finish the job, after all claimed lessons have settled.
    if (!controller.signal.aborted && isCurrentRunningJob(courseId, jobId) && isCurrentSourceVersion(courseId, jobId)) {
      useCourseStore.getState().finishOptimization(courseId, jobId)
    }
  } catch (error) {
    if (!isAbortError(error) && isCurrentRunningJob(courseId, jobId)) {
      const message = error instanceof Error ? error.message : '课程优化失败'
      useCourseStore.getState().setOptimizationStatus(courseId, jobId, 'failed', message)
    }
  } finally {
    activeOptimizationRuns.delete(jobId)
    // 兼容旧版本可能遗留的“后台生成与单关优化同时进行”状态：优化结束后恢复原任务。
    const latest = getCourseBundle(courseId)
    const latestJob = latest?.optimizationJob
    if (
      latest &&
      latestJob?.id === jobId &&
      latestJob.kind === 'single' &&
      latestJob.status !== 'running' &&
      latestJob.status !== 'paused' &&
      latest.generatingLessons &&
      !latest.generationPaused &&
      latest.lessons.some(lesson => !lesson.content)
    ) {
      void generateAllLessonsInBackground(courseId)
    }
  }
}

export function startBatchCourseOptimization(courseId: string): string | null {
  const bundle = getCourseBundle(courseId)
  if (!bundle || bundle.generatingLessons) return null
  const jobId = useCourseStore.getState().beginOptimization(
    courseId,
    'batch',
    undefined,
    sourceFingerprint(bundle.rawText),
  )
  if (jobId) void runCourseOptimization(courseId, jobId)
  return jobId
}

export async function rebuildCourseLessonStructure(courseId: string): Promise<{
  before: number
  after: number
  reused: number
  pending: number
} | null> {
  const bundle = getCourseBundle(courseId)
  if (!bundle || bundle.generatingLessons || ['running', 'paused'].includes(bundle.optimizationJob?.status ?? '')) return null
  const fallbackSource = bundle.course.files.length === 1
    ? bundle.course.files[0].name
    : `${bundle.course.name}（原课件）`
  const sources = splitStoredCourseText(bundle.rawText, fallbackSource)
  if (sources.length === 0) return null

  useCourseStore.getState().setPreparationProgress(courseId, { stage: 'extracting', current: 0, total: 0 })
  try {
    const points = await extractExamPointsFromSources(sources, bundle.course.name)
    const count = recommendLessonCount(points).suggested
    if (!count) return null
    return useCourseStore.getState().rebuildLessonStructure(courseId, points, count)
  } finally {
    useCourseStore.getState().setPreparationProgress(courseId, { stage: 'idle', current: 0, total: 0 })
  }
}

export function startSingleLessonOptimization(courseId: string, lessonId: string): string | null {
  const bundle = getCourseBundle(courseId)
  if (!bundle || bundle.generatingLessons) return null
  const jobId = useCourseStore.getState().beginOptimization(
    courseId,
    'single',
    lessonId,
    sourceFingerprint(bundle.rawText),
  )
  if (jobId) void runCourseOptimization(courseId, jobId)
  return jobId
}

/** App 完成 hydration 后调用；刷新只会重建尚未完成的请求。 */
export function resumeCourseOptimization(courseId: string): void {
  const job = getCourseBundle(courseId)?.optimizationJob
  if (!job || job.status !== 'running') return
  void runCourseOptimization(courseId, job.id)
}

export function cancelCourseOptimization(courseId: string): void {
  const job = getCourseBundle(courseId)?.optimizationJob
  if (!job || job.status !== 'running') return
  useCourseStore.getState().setOptimizationStatus(courseId, job.id, 'cancelled')
  activeOptimizationRuns.get(job.id)?.abort()
}

export function resumePausedCourseOptimization(courseId: string): void {
  const job = getCourseBundle(courseId)?.optimizationJob
  if (!job || job.status !== 'paused') return
  useCourseStore.getState().setOptimizationStatus(courseId, job.id, 'running')
  void runCourseOptimization(courseId, job.id)
}
