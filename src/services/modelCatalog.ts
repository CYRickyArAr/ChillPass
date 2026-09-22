/**
 * 模型目录服务
 * - 内置回退目录：服务商接口不可用时展示（含本地化说明）
 * - 实时拉取：调用服务商 OpenAI 兼容的 GET /models 接口，获取账号实际可用模型
 */
import { translate, type TranslationKey } from '../i18n'
import { useLanguageStore } from '@stores/languageStore'
import type { AIProvider } from '@stores/settingsStore'

const PROVIDER_MODEL_BASE_URL: Record<string, string> = {
  deepseek: 'https://api.deepseek.com',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  kimi: 'https://api.moonshot.cn/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  minimax: 'https://api.minimax.chat/v1',
  hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1',
  baidu: 'https://qianfan.baidubce.com/v2',
  baichuan: 'https://api.baichuan-ai.com/v1',
  stepfun: 'https://api.stepfun.com/v1',
  yi: 'https://api.lingyiwanwu.com/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
}

const PROVIDER_DEFAULT_FALLBACK_MODEL: Record<string, string> = {
  deepseek: 'deepseek-flash',
  zhipu: 'glm-5.3-flash',
  qwen: 'qwen-plus',
  kimi: 'kimi-k2.7-code',
  doubao: 'doubao-seed-1-6',
  minimax: 'MiniMax-M2',
  hunyuan: 'hunyuan-turbos-latest',
  baidu: 'ernie-4.5-turbo-128k',
  baichuan: 'Baichuan4-Turbo',
  stepfun: 'step-2-mini',
  yi: 'yi-lightning',
  siliconflow: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
  custom: 'gpt-4o-mini',
}

/** 内置回退目录：服务商接口不可用或未填 Key 时展示 */
export const BUILTIN_MODELS: Record<string, { id: string; descKey: TranslationKey }[]> = {
  deepseek: [
    { id: 'deepseek-flash', descKey: 'model.deepseekFlash' },
    { id: 'deepseek-v4-pro', descKey: 'model.deepseekV4Pro' },
  ],
  zhipu: [
    { id: 'glm-5.3-flash', descKey: 'model.glmFlash' },
    { id: 'glm-5.3', descKey: 'model.glm53' },
  ],
  qwen: [{ id: 'qwen-plus', descKey: 'model.unknownDesc' }],
  kimi: [{ id: 'kimi-k2.7-code', descKey: 'model.unknownDesc' }],
  doubao: [{ id: 'doubao-seed-1-6', descKey: 'model.unknownDesc' }],
  minimax: [{ id: 'MiniMax-M2', descKey: 'model.unknownDesc' }],
  hunyuan: [{ id: 'hunyuan-turbos-latest', descKey: 'model.unknownDesc' }],
  baidu: [{ id: 'ernie-4.5-turbo-128k', descKey: 'model.unknownDesc' }],
  baichuan: [{ id: 'Baichuan4-Turbo', descKey: 'model.unknownDesc' }],
  stepfun: [{ id: 'step-2-mini', descKey: 'model.unknownDesc' }],
  yi: [{ id: 'yi-lightning', descKey: 'model.unknownDesc' }],
  siliconflow: [{ id: 'Qwen/Qwen3-235B-A22B-Instruct-2507', descKey: 'model.unknownDesc' }],
  custom: [{ id: 'gpt-4o-mini', descKey: 'model.customCompatible' }],
}

for (const id of Object.keys(PROVIDER_DEFAULT_FALLBACK_MODEL)) {
  if (!BUILTIN_MODELS[id]) {
    BUILTIN_MODELS[id] = [{ id: PROVIDER_DEFAULT_FALLBACK_MODEL[id], descKey: 'model.unknownDesc' }]
  }
}

/**
 * 已知模型的说明键：用于给实时拉取回来的模型 ID 匹配本地化说明
 * 未收录的模型显示通用说明
 */
const KNOWN_MODEL_DESC: Record<string, TranslationKey> = {
  'deepseek-flash': 'model.deepseekFlash',
  'deepseek-v4-pro': 'model.deepseekV4Pro',
  'deepseek-v4-flash': 'model.deepseekV4FlashLegacy',
  'deepseek-v4-flash-vision-exp': 'model.deepseekVisionExp',
  'deepseek-chat': 'model.deepseekChatLegacy',
  'deepseek-reasoner': 'model.deepseekReasonerLegacy',
  'glm-5.3-flash': 'model.glmFlash',
  'glm-5.3': 'model.glm53',
}

/**
 * 已退役且调用会报错的模型 ID → 替代模型
 * deepseek-chat / deepseek-reasoner 已于 2026-07-24 退役，直接用会返回 404
 */
export const RETIRED_MODEL_ALIASES: Record<string, string> = {
  'deepseek-chat': 'deepseek-flash',
  'deepseek-reasoner': 'deepseek-flash',
}

/** 把历史遗留的失效模型 ID 归一化为当前可用模型 */
export function normalizeModelId(model: string): string {
  return RETIRED_MODEL_ALIASES[model] ?? model
}

/**
 * 模型的视觉（图片理解）能力
 * 仅标注已知不支持视觉的模型；未收录的模型返回 'unknown'，不做拦截
 */
const MODEL_VISION: Record<string, boolean> = {
  'deepseek-flash': true,
  'deepseek-v4-pro': false,
  'deepseek-v4-flash': true,
  'deepseek-v4-flash-vision-exp': true,
  'deepseek-chat': false,
  'deepseek-reasoner': false,
}

/** 该模型是否支持图片理解：'yes' / 'no' / 'unknown'（未收录） */
export function modelVisionSupport(model: string): 'yes' | 'no' | 'unknown' {
  const v = MODEL_VISION[model]
  return v === undefined ? 'unknown' : v ? 'yes' : 'no'
}

/** 取模型说明文案（未收录的模型返回通用说明） */
export function describeModel(model: string): string {
  const lang = useLanguageStore.getState().language
  const key = KNOWN_MODEL_DESC[model]
  return translate(lang, key ?? 'model.unknownDesc')
}

/** 该模型是否有内置说明 */
export function hasModelDescription(model: string): boolean {
  return !!KNOWN_MODEL_DESC[model]
}

/** 服务层抛错的本地化文本 */
function modelError(key: TranslationKey, map?: Record<string, string>): Error {
  let msg = translate(useLanguageStore.getState().language, key)
  for (const [k, v] of Object.entries(map ?? {})) msg = msg.replace(`{${k}}`, v)
  return new Error(msg)
}

function trimTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function normalizeCustomBaseUrl(url: string): string {
  const trimmed = trimTrailingSlash(url)
  if (!trimmed) return ''
  return trimmed.endsWith('/chat/completions')
    ? trimmed.slice(0, -'/chat/completions'.length)
    : trimmed.replace(/\/chat\/completions$/i, '')
}

export function customChatCompletionsUrl(baseUrl: string): string {
  const base = normalizeCustomBaseUrl(baseUrl)
  return base ? `${base}/chat/completions` : ''
}

export interface FetchProviderModelsOptions {
  customBaseUrl?: string
  timeoutMs?: number
}

function providerModelsUrl(provider: AIProvider, overrideCustomBaseUrl?: string): string {
  const base = normalizeCustomBaseUrl(overrideCustomBaseUrl ?? PROVIDER_MODEL_BASE_URL[provider])
  if (!base) throw modelError('api.customBaseUrlRequired')
  return `${base}/models`
}

function parseModelIds(data: unknown): string[] {
  const ids: string[] = Array.isArray((data as { data?: unknown })?.data)
    ? ((data as { data: unknown[] }).data)
        .map((m: { id?: unknown }) => (typeof m?.id === 'string' ? m.id : ''))
        .filter((id: string) => id.length > 0)
    : []

  // 去重并保持服务商返回的顺序
  return Array.from(new Set(ids))
}

async function readJsonOrThrow(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw modelError('service.apiError', {
      code: String(res.status),
      msg: text.slice(0, 200),
    })
  }
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw modelError('service.apiError', {
      code: String(res.status),
      msg: text.slice(0, 200),
    })
  }
}

async function fetchModelsDirect(url: string, key: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
    },
    signal,
  })
  return readJsonOrThrow(res)
}

async function fetchModelsViaLocalProxy(url: string, key: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch('/api/fetchProviderModels', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, apiKey: key }),
    signal,
  })
  return readJsonOrThrow(res)
}

/**
 * 实时拉取服务商当前可用的模型 ID 列表
 * 使用与对话接口相同的 API Key 做 Bearer 认证
 */
export async function fetchProviderModels(
  provider: AIProvider,
  apiKey: string,
  options: number | FetchProviderModelsOptions = 15000,
): Promise<string[]> {
  const key = apiKey.trim()
  if (!key) throw modelError('service.noApiKey')
  const timeoutMs = typeof options === 'number' ? options : options.timeoutMs ?? 15000
  const customBaseUrl = typeof options === 'number' ? undefined : options.customBaseUrl
  const url = providerModelsUrl(provider, customBaseUrl)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    try {
      return parseModelIds(await fetchModelsDirect(url, key, controller.signal))
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err
      return parseModelIds(await fetchModelsViaLocalProxy(url, key, controller.signal))
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw modelError('service.timeout')
    }
    throw err instanceof Error ? err : modelError('common.unknownError')
  } finally {
    clearTimeout(timeoutId)
  }
}

export function getProviderDefaultModel(provider: AIProvider): string {
  return PROVIDER_DEFAULT_FALLBACK_MODEL[provider] ?? PROVIDER_DEFAULT_FALLBACK_MODEL.custom
}
