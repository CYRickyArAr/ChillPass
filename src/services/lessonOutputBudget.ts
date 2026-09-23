import type { ExamPoint, LessonOutputBudget } from '../types'
import { economyLessonLimits } from './lessonEconomy'

const OUTPUT_STEPS = [1536, 2304, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 393216]

/** Provider API limits checked 2026-09-15. Unknown models may retry above 8192;
 * the API's own rejection still stops the request if its actual limit is lower.
 * https://api-docs.deepseek.com/api/create-chat-completion/ (384K, both current models)
 * https://docs.bigmodel.cn/api-reference/模型-api/对话补全 (128K; GLM-4.5: 96K)
 * A provider can still reject a lower model/context-specific limit; that is not retried as truncation.
 */
export function lessonOutputCeiling(provider: string, model: string): number {
  if (provider === 'zhipu' && /^glm-4\.5(?:-|$)/.test(model)) return 98304
  if (provider === 'zhipu') return 131072
  return 393216
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
  // A generous first-request ceiling avoids paying for several discarded short attempts.
  // The concise prompt still targets a short answer; maxTokens is only a cap.
  const base = 8192
  const saved = recovery.savedBudget
  const previouslyTruncated = /被截断|truncat/i.test(recovery.previousError ?? '')
  let maxTokens = Math.min(base, ceiling)
  if (saved?.key === key && Number.isFinite(saved.maxTokens) && saved.maxTokens > 0) {
    maxTokens = Math.min(ceiling, Math.max(maxTokens, Math.floor(saved.maxTokens)))
    if (previouslyTruncated) maxTokens = nextLessonOutputLimit(maxTokens, ceiling)
  } else if (!saved && previouslyTruncated) {
    // Legacy failures used smaller concise limits but saved no budget.
    const oldLimit = economical ? Math.min(8192, economyLessonLimits(point).maxTokens + 768) : base
    maxTokens = Math.max(maxTokens, nextLessonOutputLimit(oldLimit, ceiling))
  }
  return { key, ceiling, maxTokens, resumed: maxTokens > Math.min(base, ceiling) }
}
