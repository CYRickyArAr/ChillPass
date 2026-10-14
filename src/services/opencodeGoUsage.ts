import type { ProviderBalance } from './providerBalance'

const WINDOWS = [
  { id: 'rolling', label: '5 小时', short: '5h' },
  { id: 'weekly', label: '每周', short: '周' },
  { id: 'monthly', label: '每月', short: '月' },
] as const

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function percent(value: number): string {
  // Do not round a small remaining amount up to a full quota.
  return `${Math.floor(value * 10) / 10}%`
}

function resetDetail(value: unknown, now: number): string {
  const timestamp = typeof value === 'string' && value.trim() ? Date.parse(value) : NaN
  if (!Number.isFinite(timestamp)) return '重置时间未提供'
  const date = new Date(timestamp).toLocaleString()
  const minutes = Math.ceil((timestamp - now) / 60_000)
  if (minutes <= 0) return `重置时间 ${date}（请刷新确认）`
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  const duration = [days ? `${days}天` : '', hours ? `${hours}小时` : '', rest ? `${rest}分钟` : ''].join('')
  return `${duration}后重置（${date}）`
}

/** Go reports used percentages, not a dollar balance or local token totals. */
export function formatOpenCodeGoUsage(raw: unknown, now = Date.now()): ProviderBalance {
  const usage = record(record(raw)?.usage)
  if (!usage) throw new Error('OpenCode Go 未返回可识别的额度数据，请查看官方控制台。')

  const windows = WINDOWS.map(window => {
    const source = record(usage[window.id])
    const used = source?.percent
    // Missing/null/invalid values must never appear as "100% remaining".
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) return null
    const status = typeof source?.status === 'string' ? source.status.slice(0, 80) : ''
    const remaining = status === 'exhausted' ? 0 : Math.max(0, 100 - used)
    return { ...window, used, remaining, status, resetsAt: source?.resetsAt }
  })
  const valid = windows.filter((window): window is NonNullable<typeof window> => window !== null)
  if (!valid.length) throw new Error('OpenCode Go 未返回有效的额度百分比，接口可能已变化，请查看官方控制台。')

  // Keep every quota visible, including missing windows rather than inventing a balance.
  const text = `余量 ${windows.map((window, index) => `${WINDOWS[index].short} ${window ? percent(window.remaining) : '—'}`).join(' · ')}`
  const detail = windows.map((window, index) => {
    if (!window) return `${WINDOWS[index].label}：未返回有效额度`
    const state = window.status === 'exhausted' ? '；额度已用尽'
      : window.status && window.status !== 'ok' ? `；状态：${window.status}` : ''
    return `${window.label}：剩余 ${percent(window.remaining)}，已用 ${percent(window.used)}${state}\n${resetDetail(window.resetsAt, now)}`
  })
  detail.push('来源：OpenCode Go 套餐额度；顶栏依次显示 5 小时、每周、每月的剩余比例')
  detail.push(`更新于 ${new Date(now).toLocaleTimeString()}（重置倒计时以查询时刻为准）`)
  return {
    provider: 'opencode-go',
    text,
    detail: detail.join('\n'),
    raw,
  }
}

export async function fetchOpenCodeGoBalance(apiKey: string, signal?: AbortSignal): Promise<ProviderBalance> {
  const key = apiKey.trim()
  if (!key) throw new Error('请先配置 OpenCode Go 套餐 API Key。')
  const timeout = AbortSignal.timeout(20_000)
  try {
    const response = await fetch('/api/opencode-go/usage', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${key}`, 'X-ChillPass-Client': '1' },
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (response.status === 404) throw new Error('本地服务尚未支持 Go 额度查询，请重启 ChillPass 本地服务；独立 exe 需要更新版本。')
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('本地服务未返回 Go 额度数据，请重启 ChillPass 本地服务后重试。')
    }
    const raw: unknown = await response.json()
    if (!response.ok) {
      const message = record(record(raw)?.error)?.message
      throw new Error(typeof message === 'string' ? message : `OpenCode Go 额度查询失败（HTTP ${response.status}）。`)
    }
    return formatOpenCodeGoUsage(raw)
  } catch (error) {
    if (signal?.aborted) throw error
    if (timeout.aborted) throw new Error('OpenCode Go 额度查询超时，请稍后重试。')
    if (error instanceof TypeError) throw new Error('无法连接 Go 额度查询服务，请检查本地服务和网络。')
    throw error
  }
}
