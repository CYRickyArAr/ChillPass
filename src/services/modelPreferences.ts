import type { ProviderConnectionSettings } from '../stores/settingsStore'

/** Missing preference means all models; an explicit empty list means none. */
export function enabledModelIds(catalog: string[], enabled?: string[]): string[] {
  const ids = Array.from(new Set(catalog.filter(Boolean)))
  return enabled === undefined ? ids : ids.filter(id => enabled.includes(id))
}

export function preferredEnabledModel(connection: Pick<ProviderConnectionSettings, 'model' | 'enabledModels'>, requested: string): string {
  if (connection.enabledModels === undefined) return requested || connection.model || ''
  if (connection.enabledModels.length === 0) throw new Error('该服务商的模型已全部关闭，请在设置 → 模型中启用至少一个模型。')
  if (connection.enabledModels.includes(requested)) return requested
  return connection.model && connection.enabledModels.includes(connection.model) ? connection.model : connection.enabledModels[0]
}
