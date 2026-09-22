import type { ExamPoint, LessonOutputBudget } from '../types'
import { economyLessonLimits } from './lessonEconomy'

const OUTPUT_STEPS = [1536, 2304, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 393216]

/** Provider API limits checked 2026-09-15. Unknown models keep a conservative fallback.
 * https://api-docs.deepseek.com/api/create-chat-completion/ (384K, both current models)
 * https://docs.bigmodel.cn/api-reference/模型-api/对话补全 (128K; GLM-4.5: 96K)
 * A provider can still reject a lower model/context-specific limit; that is not retried as truncation.
 */
export function lessonOutputCeiling(provider: string, model: string): number {
  if (provider === 'deepseek' && ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(model)) return 393216
  if (provider === 'zhipu' && /^glm-4\.5(?:-|$)/.test(model)) return 98304
  if (provider === 'zhipu' && /^glm-(?:5(?:\.|-|$)|4\.[67](?:-|$))/.test(model)) return 131072
  return 8192
}

export function nextLessonOutputLimit(current: number, ceiling: number): number {
  return Math.min(ceiling, OUTPUT_STEPS.find(limit => limit > current) ?? ceiling)
}

export interface LessonOutputRecovery {
  savedBudget?: LessonOutputBudget
  previousError?: string
  onBudgetChange?: (budget: LessonOutputBudget) => void
}

export function lessonOutputPolicy(point: ExamPoint, provider: string, model: string, economical: boolean, recovery: LessonOutputRecovery = {}) {
  const key = `${provider}:${model}:${economical ? 'concise' : 'full'}`
  const ceiling = lessonOutputCeiling(provider, model)
  const base = economical ? economyLessonLimits(point).maxTokens : 8192
  const saved = recovery.savedBudget
  let maxTokens = Math.min(base, ceiling)
  if (saved?.key === key && Number.isFinite(saved.maxTokens) && saved.maxTokens > 0) {
    maxTokens = Math.min(ceiling, Math.max(maxTokens, Math.floor(saved.maxTokens)))
  } else if (!saved && /被截断|truncat/i.test(recovery.previousError ?? '')) {
    // Legacy failures used 1536/2304 (or the larger merged-topic equivalent), but saved no budget.
    const oldLimit = economical ? Math.min(8192, base + 768) : base
    maxTokens = Math.max(maxTokens, nextLessonOutputLimit(oldLimit, ceiling))
  }
  return { key, ceiling, maxTokens, resumed: maxTokens > Math.min(base, ceiling) }
}
