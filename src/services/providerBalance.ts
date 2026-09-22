import type { AIProvider, CustomUsageQuerySettings } from '@stores/settingsStore'
import {
  fetchDeepSeekBalance,
  type DeepSeekBalance,
} from './deepseekBalance'

const ZHIPU_QUOTA_URL = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit'

export interface ProviderBalance {
  provider: AIProvider
  text: string
  detail?: string
  raw: unknown
}

interface CustomUsageExtractorResult {
  isValid?: unknown
  invalidMessage?: unknown
  remaining?: unknown
  unit?: unknown
  total?: unknown
  used?: unknown
  extra?: unknown
}

interface CustomUsageScript {
  request?: {
    url?: unknown
    method?: unknown
    headers?: unknown
    body?: unknown
  }
  extractor?: unknown
}

function formatCurrencyBalance(balance: DeepSeekBalance): ProviderBalance {
  const primary = balance.balances.find(item => item.currency === 'CNY') ?? balance.balances[0]
  const symbol = primary.currency === 'CNY'
    ? '¥'
    : primary.currency === 'USD'
      ? '$'
      : `${primary.currency} `
  return {
    provider: 'deepseek',
    text: `${symbol}${primary.totalBalance}`,
    detail: primary.currency,
    raw: balance,
  }
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

function replaceTemplate(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{(apiKey|baseUrl)\}\}/g, (_, key: keyof typeof variables) => variables[key] ?? '')
}

function replaceTemplatesDeep(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === 'string') return replaceTemplate(value, variables)
  if (Array.isArray(value)) return value.map(item => replaceTemplatesDeep(item, variables))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      replaceTemplatesDeep(item, variables),
    ]),
  )
}

function formatCustomUsageResult(provider: AIProvider, result: CustomUsageExtractorResult, raw: unknown): ProviderBalance {
  if (result.isValid === false) {
    throw new Error(typeof result.invalidMessage === 'string' ? result.invalidMessage : 'Custom usage query returned invalid')
  }

  const unit = typeof result.unit === 'string' ? result.unit : ''
  if (typeof result.remaining === 'number') {
    return {
      provider,
      text: unit === '%' ? `余 ${Math.round(result.remaining)}%` : `余 ${formatCount(result.remaining)}${unit ? ` ${unit}` : ''}`,
      detail: typeof result.extra === 'string' ? result.extra : undefined,
      raw,
    }
  }
  if (typeof result.remaining === 'string' && result.remaining.trim()) {
    return {
      provider,
      text: unit ? `${result.remaining.trim()} ${unit}` : result.remaining.trim(),
      detail: typeof result.extra === 'string' ? result.extra : undefined,
      raw,
    }
  }

  const total = typeof result.total === 'number' ? result.total : null
  const used = typeof result.used === 'number' ? result.used : null
  if (total !== null && used !== null && total > 0) {
    const remainingPercent = Math.max(0, Math.min(100, Math.round(((total - used) / total) * 100)))
    return {
      provider,
      text: `余 ${remainingPercent}%`,
      detail: `已用 ${formatCount(used)} · 总 ${formatCount(total)}`,
      raw,
    }
  }

  throw new Error('Custom usage extractor must return remaining or total/used')
}

async function fetchCustomBalance(
  provider: AIProvider,
  apiKey: string,
  baseUrl: string,
  customUsageQuery: CustomUsageQuerySettings,
  signal?: AbortSignal,
): Promise<ProviderBalance> {
  if (!customUsageQuery.enabled || !customUsageQuery.script.trim()) {
    throw new Error('Custom usage query is not configured')
  }

  const script = Function(`"use strict"; return (${customUsageQuery.script});`)() as CustomUsageScript
  if (!script || typeof script !== 'object') throw new Error('Custom usage query script is invalid')
  if (!script.request || typeof script.request !== 'object') throw new Error('Custom usage query request is missing')
  if (typeof script.extractor !== 'function') throw new Error('Custom usage query extractor is missing')

  const variables = {
    apiKey: apiKey.trim(),
    baseUrl: baseUrl.trim().replace(/\/+$/, ''),
  }
  const url = replaceTemplate(String(script.request.url ?? ''), variables).trim()
  if (!url) throw new Error('Custom usage query URL is missing')

  const method = String(script.request.method ?? 'GET').toUpperCase()
  const headers = replaceTemplatesDeep(script.request.headers ?? {}, variables) as Record<string, string>
  const rawBody = replaceTemplatesDeep(script.request.body, variables)
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : typeof rawBody === 'string'
      ? rawBody
      : rawBody === undefined
        ? undefined
        : JSON.stringify(rawBody)

  const response = await fetch(url, {
    method,
    headers,
    body,
    signal,
  })
  const contentType = response.headers.get('content-type') ?? ''
  const raw = contentType.includes('application/json')
    ? await response.json()
    : await response.text()
  if (!response.ok) {
    throw new Error(`Custom usage request failed (${response.status})`)
  }

  const result = script.extractor(raw) as CustomUsageExtractorResult
  return formatCustomUsageResult(provider, result ?? {}, raw)
}

function parseZhipuQuota(data: unknown): ProviderBalance {
  const payload = data as {
    data?: {
      limits?: Array<{
        type?: unknown
        percentage?: unknown
        remaining?: unknown
        usage?: unknown
        currentValue?: unknown
      }>
    }
  }
  const limits = Array.isArray(payload?.data?.limits) ? payload.data.limits : []
  const tokenLimit = limits.find(item => item.type === 'TOKENS_LIMIT') ?? limits[0]
  if (!tokenLimit) {
    throw new Error('GLM quota response is empty')
  }

  const percentage = typeof tokenLimit.percentage === 'number' ? tokenLimit.percentage : null
  const remaining = typeof tokenLimit.remaining === 'number' ? tokenLimit.remaining : null
  const usage = typeof tokenLimit.currentValue === 'number'
    ? tokenLimit.currentValue
    : typeof tokenLimit.usage === 'number'
      ? tokenLimit.usage
      : null
  const remainingPercent = percentage === null
    ? null
    : Math.max(0, Math.min(100, Math.round(100 - percentage)))

  return {
    provider: 'zhipu',
    text: remainingPercent !== null
      ? `余 ${remainingPercent}%`
      : remaining !== null
        ? `余 ${formatCount(remaining)}`
        : '已查询',
    detail: [
      usage !== null ? `已用 ${formatCount(usage)}` : '',
      remaining !== null ? `剩余 ${formatCount(remaining)}` : '',
    ].filter(Boolean).join(' · '),
    raw: data,
  }
}

async function fetchZhipuQuotaWithAuth(
  apiKey: string,
  authorization: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(ZHIPU_QUOTA_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: authorization,
    },
    signal,
  })
}

export async function fetchZhipuBalance(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ProviderBalance> {
  const key = apiKey.trim()
  if (!key) throw new Error('GLM API Key is missing')

  let response = await fetchZhipuQuotaWithAuth(key, key, signal)
  if (response.status === 401 || response.status === 403) {
    response = await fetchZhipuQuotaWithAuth(key, `Bearer ${key}`, signal)
  }
  if (!response.ok) {
    throw new Error(`GLM quota request failed (${response.status})`)
  }

  return parseZhipuQuota(await response.json())
}

export async function fetchProviderBalance(
  provider: AIProvider,
  apiKey: string,
  options: {
    customBaseUrl?: string
    customUsageQuery?: CustomUsageQuerySettings
  } = {},
  signal?: AbortSignal,
): Promise<ProviderBalance> {
  if (provider === 'deepseek') {
    return formatCurrencyBalance(await fetchDeepSeekBalance(apiKey, signal))
  }
  if (provider === 'zhipu') {
    return fetchZhipuBalance(apiKey, signal)
  }
  return fetchCustomBalance(provider, apiKey, options.customBaseUrl ?? '', options.customUsageQuery ?? { enabled: false, script: '' }, signal)
}
