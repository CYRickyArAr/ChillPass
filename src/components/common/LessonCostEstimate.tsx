import { useSettingsStore } from '@stores/settingsStore'
import { estimateEconomyLessons } from '@services/lessonEconomy'
import { useT } from '../../i18n'

/** Explicit assumptions; never present the range as a measured bill or a hard limit. */
export default function LessonCostEstimate({ count, sourceTopics = count, example = false }: { count: number; sourceTopics?: number; example?: boolean }) {
  const economy = useSettingsStore(state => state.economyLessons)
  const provider = useSettingsStore(state => state.provider)
  const t = useT()
  if (!economy || count < 1) return null
  if (provider !== 'deepseek') return <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{t('progress.economyOtherProvider')}</p>
  const estimate = estimateEconomyLessons(count, sourceTopics)
  const range = (values: readonly number[]) => values.map(value => value.toFixed(2)).join('–')
  return <aside style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, marginBlock: 12 }}>
    <strong style={{ color: 'var(--accent-text)' }}>{t(example ? 'progress.economySample' : 'progress.economyEstimate').replace('{count}', String(count))}</strong>
    <div>{t('progress.economyPrices').replace('{off}', range(estimate.offPeak)).replace('{peak}', range(estimate.peak))}</div>
    <div>{t('progress.economyEstimateHint')}{' '}
      <a href="https://api-docs.deepseek.com/zh-cn/quick_start/pricing/" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)' }}>{t('progress.economyPricingLink')}</a>
    </div>
  </aside>
}
