import type { CourseBundle } from '../types'

/** Only committed content is learnable; a batch's processed count can include failures. */
export function getReadyLessonState(bundle?: CourseBundle | null) {
  const job = bundle?.optimizationJob
  const replacing = job?.status === 'running' || job?.status === 'paused'
  const readyLessons = (bundle?.lessons ?? [])
    .filter(lesson => {
      const state = job?.items[lesson.id]?.state
      return !!lesson.content && !(replacing && (state === 'pending' || state === 'processing'))
    })
    .sort((a, b) => a.order - b.order)
  const completed = readyLessons.filter(lesson => lesson.status === 'completed')
  const lastCompleted = completed.reduce<typeof completed[number] | undefined>((latest, lesson) => {
    if (!latest) return lesson
    const timeDifference = (lesson.completedAt ?? 0) - (latest.completedAt ?? 0)
    return timeDifference > 0 || (timeDifference === 0 && lesson.order > latest.order) ? lesson : latest
  }, undefined)
  const unfinished = readyLessons.filter(lesson => lesson.status !== 'completed')
  const nextLesson = unfinished.find(lesson => lesson.order > (lastCompleted?.order ?? -Infinity))
    ?? unfinished[0]
    ?? lastCompleted
  return { readyLessons, nextLesson }
}
