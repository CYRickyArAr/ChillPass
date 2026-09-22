import { generateLessonContent } from './deepseek'
import { useCourseStore } from '@stores/courseStore'
import { beginOperation, isOperationActive, operationErrorText, useOperationProgressStore } from '@stores/operationProgressStore'
import { translate } from '../i18n/translations'
import { useLanguageStore } from '@stores/languageStore'
import { BACKGROUND_CONCURRENCY, mapConcurrent } from './aiScheduling'

const activeCourseGenerations = new Map<string, AbortController>()

export function cancelLessonGeneration(courseId: string): void {
  useCourseStore.getState().setGenerationPaused(true, courseId)
  activeCourseGenerations.get(courseId)?.abort()
  const bundle = useCourseStore.getState().courses.find(item => item.course.id === courseId)
  if (bundle) {
    const courseLessonTitles = new Set(bundle.examPoints.map(point => point.title))
    useOperationProgressStore.getState().finishMatching(
      item => item.kind === 'lesson'
        && isOperationActive(item)
        && (item.detail === bundle.course.name || courseLessonTitles.has(item.detail)),
      'cancelled',
    )
    useCourseStore.getState().setGeneratingLessons(
      false,
      bundle.generationProgress,
      courseId,
    )
  }
}

/**
 * 在后台为课程的所有关卡生成学习内容
 * 受控并发，每关独立保存；全局请求队列限制并发，给交互操作保留位置。
 */
export async function generateAllLessonsInBackground(courseId: string): Promise<void> {
  const store = useCourseStore.getState()
  const bundle = store.courses.find(b => b.course.id === courseId)
  if (!bundle || bundle.lessons.length === 0) return
  if (bundle.optimizationJob?.status === 'running' || bundle.optimizationJob?.status === 'paused') return
  if (activeCourseGenerations.has(courseId)) return

  const { lessons, examPoints, rawText } = bundle
  const total = lessons.length
  const controller = new AbortController()
  const pendingLessons = lessons.filter(lesson => !lesson.content)
  let completed = total - pendingLessons.length
  let processed = completed
  let failed = 0
  let fatalError = false
  const operation = beginOperation('lesson', bundle.course.name)
  operation.report({ stage: 'processing', current: processed, total, unit: 'lessons' })
  activeCourseGenerations.set(courseId, controller)

  store.setGenerationPaused(false, courseId)
  store.setGeneratingLessons(true, { current: completed, total }, courseId)

  try {
    await mapConcurrent(pendingLessons, BACKGROUND_CONCURRENCY, async (lesson, _index, workSignal) => {
      const current = useCourseStore.getState().courses.find(item => item.course.id === courseId)
      if (!current || current.rawText !== rawText || current.optimizationJob?.status === 'running') {
        controller.abort()
        return
      }
      if (workSignal.aborted) return
      if (current.lessons.find(item => item.id === lesson.id)?.content) {
        processed++
        completed = current.lessons.filter(item => item.content).length
        operation.report({ current: processed, failed })
        return
      }
      const examPoint = examPoints.find(p => p.id === lesson.examPointId)
      useCourseStore.getState().setLessonGenerationError(lesson.id, undefined, courseId)

      if (examPoint) {
        try {
          const latest = useCourseStore.getState().courses.find(item => item.course.id === courseId)
          const recentQuestions = (latest?.lessons ?? []).filter(item => item.content).slice(-4)
            .flatMap(item => (item.content!.quiz ?? []).map(question => question.question)).slice(-12)
          // 按关卡顺序收集前面已经讲过的知识点，避免本关重复解释前置概念。
          const priorKeyPoints = (latest?.lessons ?? [])
            .filter(item => item.order < lesson.order && item.content?.keyPoints?.length)
            .sort((a, b) => a.order - b.order)
            .flatMap(item => item.content!.keyPoints)
            .slice(-24)
          const content = await generateLessonContent(examPoint, rawText, workSignal, bundle.course.name, recentQuestions, {
            savedBudget: lesson.generationBudget,
            previousError: lesson.generationError,
            onBudgetChange: budget => {
              const fresh = useCourseStore.getState().courses.find(item => item.course.id === courseId)
              const target = fresh?.lessons.find(item => item.id === lesson.id)
              if (workSignal.aborted || !fresh || fresh.rawText !== rawText || target?.examPointId !== lesson.examPointId) {
                controller.abort()
                throw new DOMException('Generation context changed', 'AbortError')
              }
              if (!target.content) {
                useCourseStore.getState().setLessonGenerationBudget(lesson.id, budget, courseId)
              }
            },
          }, priorKeyPoints)
          if (workSignal.aborted) return
          const fresh = useCourseStore.getState().courses.find(item => item.course.id === courseId)
          const target = fresh?.lessons.find(item => item.id === lesson.id)
          if (!fresh || fresh.rawText !== rawText || target?.examPointId !== lesson.examPointId) {
            controller.abort()
            return
          }
          // Never replace a completed in-flight result from another action.
          if (!target.content) useCourseStore.getState().setLessonContent(lesson.id, content, courseId)
          completed = useCourseStore.getState().courses.find(item => item.course.id === courseId)?.lessons.filter(item => item.content).length ?? completed
        } catch (error) {
          if (workSignal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
            return
          }
          const fresh = useCourseStore.getState().courses.find(item => item.course.id === courseId)
          if (!fresh || fresh.rawText !== rawText || fresh.lessons.find(item => item.id === lesson.id)?.examPointId !== lesson.examPointId) {
            controller.abort()
            return
          }
          // 单个关卡生成失败不影响其他关卡
          console.error(`关卡 "${lesson.title}" 内容生成失败:`, error)
          useCourseStore.getState().setLessonGenerationError(lesson.id, operationErrorText(error), courseId)
          failed += 1
        }
      } else {
        useCourseStore.getState().setLessonGenerationError(lesson.id, translate(useLanguageStore.getState().language, 'progress.missingLessonPoint'), courseId)
        failed += 1
      }

      processed += 1
      operation.report({ current: processed, failed })
      useCourseStore.getState().setGeneratingLessons(true, { current: completed, total }, courseId)
    }, controller.signal)
  } catch (error) {
    if (controller.signal.aborted) return
    fatalError = true
    operation.report({ error: operationErrorText(error) })
  } finally {
    operation.finish(controller.signal.aborted ? 'cancelled' : failed > 0 || fatalError ? 'failed' : 'done')
    activeCourseGenerations.delete(courseId)
    const currentStore = useCourseStore.getState()
    const latest = currentStore.courses.find(item => item.course.id === courseId)
    // Failed work requires an explicit retry. Refresh must not silently start another paid batch.
    if (latest && latest.rawText === rawText && !['running', 'paused'].includes(latest.optimizationJob?.status ?? '')) {
      completed = latest.lessons.filter(lesson => lesson.content).length
      currentStore.setGenerationPaused(completed < latest.lessons.length, courseId)
      currentStore.setGeneratingLessons(false, { current: completed, total: latest.lessons.length }, courseId)
    }
  }
}
