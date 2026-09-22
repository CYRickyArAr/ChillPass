import { useState } from 'react'
import { BookOpen, ArrowRight, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { CourseBundle } from '../../types'
import { getReadyLessonState } from '../../utils/readyLessons'
import { useT } from '../../i18n'
import styles from './ReadyLessonNotice.module.css'
import { getGenerationRecovery } from '../../utils/generationRecovery'
import { generateAllLessonsInBackground } from '@services/lessonGenerator'
import { operationErrorText } from '@stores/operationProgressStore'

/** Kept outside the collapsible progress list so learning never requires waiting for the batch. */
export default function ReadyLessonNotice({ bundle }: { bundle?: CourseBundle | null }) {
  const t = useT()
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  if (!bundle || bundle.course.status !== 'ready' || !bundle.lessons.some(lesson => !lesson.content)) return null
  const { readyLessons, nextLesson } = getReadyLessonState(bundle)
  const running = bundle.generatingLessons
  const { pending, canRetry } = getGenerationRecovery(bundle)
  return (
    <div className={styles.notice}>
      <div className={styles.copy}>
        <strong>{t('progress.learnableCount')
          .replace('{ready}', String(readyLessons.length))
          .replace('{total}', String(bundle.lessons.length))}</strong>
        <span>{nextLesson
          ? t(running ? 'progress.learnWhileGenerating' : 'progress.learnWhilePaused')
          : t(running ? 'progress.firstLessonWaiting' : 'progress.noReadyLessons')}</span>
      </div>
      {canRetry && <button type="button" className={styles.start} disabled={retrying}
        onClick={async () => {
          setRetrying(true)
          setRetryError('')
          try { await generateAllLessonsInBackground(bundle.course.id) }
          catch (error) { setRetryError(operationErrorText(error)) }
          finally { setRetrying(false) }
        }}>
        <RefreshCw size={16} aria-hidden="true" />
        {t('progress.retryMissingLessons').replace('{count}', String(pending.length))}
      </button>}
      {nextLesson && <Link className={styles.start} to={`/lessons/${nextLesson.id}`}>
        <BookOpen size={16} aria-hidden="true" />
        {t(nextLesson.status === 'completed' ? 'progress.reviewReadyLesson' : 'progress.studyReadyLesson')}
        <ArrowRight size={16} aria-hidden="true" />
      </Link>}
      <Link className={styles.listLink} to="/lessons">{t('progress.viewLessons')}</Link>
      {retryError && <div className={styles.errors} role="status">{retryError}</div>}
      {canRetry && <details className={styles.errors}>
        <summary>{t('progress.generationStopped').replace('{count}', String(pending.length))}</summary>
        <p>{t('progress.retryMissingHint')}</p>
        <ul>{pending.map(lesson => <li key={lesson.id}>
          <strong>{lesson.title}</strong>：{lesson.generationError || t('progress.missingFailureDetail')}
        </li>)}</ul>
      </details>}
    </div>
  )
}
