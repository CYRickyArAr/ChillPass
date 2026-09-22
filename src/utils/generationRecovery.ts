import type { CourseBundle } from '../types'

/** Include legacy failed batches that never set generationPaused. No automatic API requests. */
export function getGenerationRecovery(bundle?: CourseBundle | null) {
  const pending = bundle?.lessons.filter(lesson => !lesson.content) ?? []
  const optimizationBlocks = ['running', 'paused'].includes(bundle?.optimizationJob?.status ?? '')
  return { pending, canRetry: !!bundle && bundle.course.status === 'ready' && pending.length > 0
    && !bundle.generatingLessons && !optimizationBlocks }
}
