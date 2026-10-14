import { CHATGPT_HEADERS } from './chatgpt'
import type { ProviderBalance } from './providerBalance'

export interface ChatGPTUsageReport {
  accountId: string
  capturedAt: number
  windows: { label: string; usedPercent: number; remainingPercent: number; resetsAt?: number }[]
  credits: number | 'unlimited' | null
  source?: 'codex-cli'
  resetCredits?: number | null
}

export function formatChatGPTUsage(report: ChatGPTUsageReport): ProviderBalance {
  const percent = (value: number) => `${Math.round(value * 10) / 10}%`
  const windows = report.windows.map(item => `${item.label} 余 ${percent(item.remainingPercent)}`)
  const credits = report.credits === null ? '' : report.credits === 'unlimited' ? '积分不限' : `积分 ${report.credits}`
  const detail = report.windows.map(item => `${item.label}：剩余 ${percent(item.remainingPercent)}${item.resetsAt ? `；重置于 ${new Date(item.resetsAt).toLocaleString()}` : ''}`)
  if (credits) detail.push(credits)
  const resets = report.resetCredits == null ? '' : `重置剩余 ${report.resetCredits} 次`
  if (resets) detail.push(resets)
  if (report.source === 'codex-cli') detail.unshift('来源：本机官方 Codex · 当前工作区订阅额度（并非 ChillPass 专属额度）')
  detail.push(`更新于 ${new Date(report.capturedAt).toLocaleTimeString()}`)
  return {
    provider: 'chatgpt',
    text: [...windows.slice(0, 2), ...(windows.length < 2 && resets ? [resets] : [])].join(' · ') || credits,
    detail: detail.join('\n'),
    raw: report,
  }
}

export function confirmCodexUsageConnection(): boolean {
  return window.confirm('连接本机官方 Codex 的订阅额度？\n\n仅查询与 ChillPass 当前 ChatGPT 账号相同的 Codex 登录。凭据和刷新由官方 CLI 管理，不会复制令牌、发起模型请求或消耗重置次数，也不会改变 ChillPass 当前的模型授权。')
}

export function connectCodexUsage(accountId: string, signal?: AbortSignal): Promise<ProviderBalance> {
  return requestBalance('/api/chatgpt/usage/connect', signal, { accountId })
}

export function fetchChatGPTBalance(signal?: AbortSignal): Promise<ProviderBalance> {
  return requestBalance('/api/chatgpt/usage', signal)
}

async function requestBalance(path: string, signal?: AbortSignal, body?: { accountId: string }): Promise<ProviderBalance> {
  const timeout = AbortSignal.timeout(45000)
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
    headers: CHATGPT_HEADERS,
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (response.status === 404 || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('本地服务尚不支持余量查询，请重启 ChillPass。')
  }
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `ChatGPT 余量查询失败 (${response.status})`)
  if (!Array.isArray(data.windows) || (!data.windows.length && data.credits == null)) throw new Error('未返回可识别的余量数据。')
  return formatChatGPTUsage(data)
}
