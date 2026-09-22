import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, ArrowRight } from 'lucide-react'
import type { CourseBundle } from '../../types'
import { useCourseStore } from '@stores/courseStore'
import { generateAllLessonsInBackground } from '@services/lessonGenerator'
import { parseLessonCount, recommendLessonCount } from '@services/lessonPlanning'
import { useT } from '../../i18n'
import styles from './LessonPlanCard.module.css'
import LessonCostEstimate from './LessonCostEstimate'

export default function LessonPlanCard({ bundle }: { bundle: CourseBundle }) {
  const t = useT()
  const navigate = useNavigate()
  const fieldId = useId()
  const updateCount = useCourseStore(s => s.setLessonPlanCount)
  const confirmPlan = useCourseStore(s => s.confirmLessonPlan)
  const [failed, setFailed] = useState(false)
  const draft = bundle.lessonPlanDraft
  if (!draft) return null
  const range = recommendLessonCount(draft.points)
  const count = parseLessonCount(draft.countInput)
  return (
    <form className={styles.card} onSubmit={event => {
      event.preventDefault()
      if (!count) return
      if (!confirmPlan(bundle.course.id)) { setFailed(true); return }
      void generateAllLessonsInBackground(bundle.course.id)
      navigate('/lessons')
    }}>
      <BookOpen size={26} className={styles.icon} aria-hidden="true" />
      <h2>{t('progress.planTitle')}</h2>
      <p>{t('progress.planReady').replace('{course}', bundle.course.name).replace('{points}', String(draft.points.length))}</p>
      <div className={styles.recommendation}>
        <strong>{t('progress.planRange').replace('{min}', String(range.min)).replace('{max}', String(range.max))}</strong>
        <span>{t('progress.planEstimate')}</span>
      </div>
      <label htmlFor={fieldId}>{t('progress.planCountLabel')}</label>
      <div className={styles.inputRow}>
        <input id={fieldId} type="text" inputMode="numeric" autoComplete="off"
          value={draft.countInput} aria-invalid={!count} aria-describedby={`${fieldId}-hint`}
          onChange={event => { updateCount(bundle.course.id, event.target.value); setFailed(false) }} />
        <span>{t('progress.lessons')}</span>
        <button type="button" className={styles.secondary} onClick={() => updateCount(bundle.course.id, String(range.suggested))}>
          {t('progress.planUseSuggested').replace('{count}', String(range.suggested))}
        </button>
      </div>
      <p id={`${fieldId}-hint`} className={!count ? styles.error : styles.hint}>
        {!count ? t('progress.planInvalid') : count < draft.points.length
          ? t('progress.planMerge').replace('{points}', String(draft.points.length)).replace('{count}', String(count))
          : count > draft.points.length ? t('progress.planSplit') : t('progress.planOnePerPoint')}
      </p>
      {count && (count < range.min || count > range.max) ? <p className={styles.warning}>{t(count < range.min ? 'progress.planLowWarning' : 'progress.planHighWarning')}</p> : null}
      <p className={styles.hint}>{t('progress.planSaved')}</p>
      {count && <LessonCostEstimate count={count} sourceTopics={draft.points.length} />}
      {failed && <p className={styles.error} role="alert">{t('progress.planConflict')}</p>}
      <button className={styles.start} type="submit" disabled={!count}>
        {t('progress.planConfirm').replace('{count}', String(count ?? '—'))}<ArrowRight size={17} aria-hidden="true" />
      </button>
    </form>
  )
}
