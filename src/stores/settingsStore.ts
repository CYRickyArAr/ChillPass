import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { normalizeModelId } from '../services/modelCatalog'

/** AI 服务提供商 */
export type BuiltinAIProvider =
  | 'deepseek'
  | 'zhipu'
  | 'qwen'
  | 'kimi'
  | 'doubao'
  | 'minimax'
  | 'hunyuan'
  | 'baidu'
  | 'baichuan'
  | 'stepfun'
  | 'yi'
  | 'siliconflow'
export type AIProvider = BuiltinAIProvider | 'custom' | `custom:${string}`

export interface ProviderPreset {
  id: BuiltinAIProvider
  name: string
  baseUrl: string
  defaultModel: string
}

export interface ProviderConnectionSettings {
  name: string
  baseUrl: string
  apiKey: string
  custom?: boolean
  usageQuery?: CustomUsageQuerySettings
}

export const BUILTIN_PROVIDER_PRESETS: Record<BuiltinAIProvider, ProviderPreset> = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
  },
  zhipu: {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.3-flash',
  },
  qwen: {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.7-code',
  },
  doubao: {
    id: 'doubao',
    name: '豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-1-6',
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    defaultModel: 'MiniMax-M2',
  },
  hunyuan: {
    id: 'hunyuan',
    name: '腾讯混元',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    defaultModel: 'hunyuan-turbos-latest',
  },
  baidu: {
    id: 'baidu',
    name: '百度千帆',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    defaultModel: 'ernie-4.5-turbo-128k',
  },
  baichuan: {
    id: 'baichuan',
    name: '百川智能',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    defaultModel: 'Baichuan4-Turbo',
  },
  stepfun: {
    id: 'stepfun',
    name: '阶跃星辰',
    baseUrl: 'https://api.stepfun.com/v1',
    defaultModel: 'step-2-mini',
  },
  yi: {
    id: 'yi',
    name: '零一万物',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    defaultModel: 'yi-lightning',
  },
  siliconflow: {
    id: 'siliconflow',
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
  },
}

export const BUILTIN_PROVIDER_IDS = Object.keys(BUILTIN_PROVIDER_PRESETS) as BuiltinAIProvider[]

/**
 * 各提供商的默认模型
 * 注意：deepseek-chat / deepseek-reasoner 已于 2026-07-24 退役（调用返回 404），
 * 现行可用模型为 deepseek-flash 与 deepseek-v4-pro
 */
export const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  ...Object.fromEntries(BUILTIN_PROVIDER_IDS.map(id => [id, BUILTIN_PROVIDER_PRESETS[id].defaultModel])),
  custom: 'gpt-4o-mini',
}

export interface CustomUsageQuerySettings {
  enabled: boolean
  script: string
}

export const DEFAULT_CUSTOM_USAGE_SCRIPT = `({
  request: {
    url: "{{baseUrl}}/user/balance",
    method: "GET",
    headers: {
      "Authorization": "Bearer {{apiKey}}"
    }
  },
  extractor: function(response) {
    return {
      isValid: response.is_available !== false,
      remaining: response.balance ?? response.remaining ?? response.total_balance,
      unit: response.currency ?? "USD"
    };
  }
})`

export const UI_FONT_SCALE_MIN = 0.9
export const UI_FONT_SCALE_MAX = 1.2
export const UI_FONT_SCALE_STEP = 0.05
export const UI_FONT_SCALE_DEFAULT = 1
export const UI_FONT_MIN_PX = 14

export function isCustomProviderId(provider: AIProvider | string): boolean {
  return provider === 'custom' || provider.startsWith('custom:')
}

function defaultProviderConnections(): Record<string, ProviderConnectionSettings> {
  return Object.fromEntries(
    BUILTIN_PROVIDER_IDS.map(id => [id, {
      name: BUILTIN_PROVIDER_PRESETS[id].name,
      baseUrl: BUILTIN_PROVIDER_PRESETS[id].baseUrl,
      apiKey: '',
      custom: false,
    }]),
  )
}

function createDefaultCustomConnection(
  name = '自定义供应商',
  baseUrl = '',
  apiKey = '',
): ProviderConnectionSettings {
  return {
    name,
    baseUrl,
    apiKey,
    custom: true,
    usageQuery: {
      enabled: false,
      script: DEFAULT_CUSTOM_USAGE_SCRIPT,
    },
  }
}

export function getProviderConnection(
  provider: AIProvider,
  state = useSettingsStore.getState(),
): ProviderConnectionSettings {
  const preset = BUILTIN_PROVIDER_PRESETS[provider as BuiltinAIProvider]
  const connection = state.providerConnections?.[provider]
  if (connection) {
    return {
      name: connection.name || preset?.name || '自定义供应商',
      baseUrl: connection.baseUrl || preset?.baseUrl || '',
      apiKey: connection.apiKey || '',
      custom: connection.custom ?? !preset,
      usageQuery: connection.usageQuery ?? {
        enabled: false,
        script: DEFAULT_CUSTOM_USAGE_SCRIPT,
      },
    }
  }
  if (preset) {
    return {
      name: preset.name,
      baseUrl: preset.baseUrl,
      apiKey: '',
      custom: false,
      usageQuery: {
        enabled: false,
        script: DEFAULT_CUSTOM_USAGE_SCRIPT,
      },
    }
  }
  return createDefaultCustomConnection(state.customProviderName, state.customBaseUrl, state.customApiKey)
}

export function getProviderDisplayName(provider: AIProvider, state = useSettingsStore.getState()): string {
  return getProviderConnection(provider, state).name || BUILTIN_PROVIDER_PRESETS[provider as BuiltinAIProvider]?.name || '自定义供应商'
}

export function normalizeUiFontScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return UI_FONT_SCALE_DEFAULT
  const stepped = Math.round((value - UI_FONT_SCALE_MIN) / UI_FONT_SCALE_STEP) * UI_FONT_SCALE_STEP + UI_FONT_SCALE_MIN
  const clamped = Math.min(UI_FONT_SCALE_MAX, Math.max(UI_FONT_SCALE_MIN, stepped))
  return Number(clamped.toFixed(2))
}

const UI_FONT_TARGET_SELECTOR = [
  'div',
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'summary',
  'p',
  'span',
  'small',
  'strong',
  'em',
  'b',
  'i',
  'li',
  'dt',
  'dd',
  'td',
  'th',
  'caption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'code',
  'pre',
  'blockquote',
].join(',')

const UI_FONT_SKIP_SELECTOR = 'svg, math, .katex-html, .katex-mathml, [data-ui-font-ignore="true"]'
let activeUiFontScale = UI_FONT_SCALE_DEFAULT
let uiFontObserver: MutationObserver | null = null
let uiFontApplyPending = false

function isUiFontTarget(element: Element): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.matches(UI_FONT_TARGET_SELECTOR) &&
    !element.closest(UI_FONT_SKIP_SELECTOR)
  )
}

function collectUiFontTargets(root: HTMLElement) {
  const targets = Array.from(root.querySelectorAll(UI_FONT_TARGET_SELECTOR)).filter(isUiFontTarget)
  return isUiFontTarget(root) ? [root, ...targets] : targets
}

function restoreUiFontOriginalSize(element: HTMLElement) {
  const originalInlineSize = element.dataset.uiFontOriginalInlineSize
  if (originalInlineSize) {
    element.style.fontSize = originalInlineSize
  } else {
    element.style.removeProperty('font-size')
  }
}

function rememberUiFontBaseSize(element: HTMLElement) {
  if (element.dataset.uiFontBaseSize) return

  const computedFontSize = Number.parseFloat(window.getComputedStyle(element).fontSize)
  if (!Number.isFinite(computedFontSize) || computedFontSize <= 0) return

  element.dataset.uiFontBaseSize = String(Number(computedFontSize.toFixed(3)))
  element.dataset.uiFontOriginalInlineSize = element.style.fontSize
}

function writeUiFontScaleToElement(element: HTMLElement, scale: number) {
  const baseFontSize = Number.parseFloat(element.dataset.uiFontBaseSize ?? '')
  if (!Number.isFinite(baseFontSize) || baseFontSize <= 0) return

  element.style.fontSize = `${Number((Math.max(UI_FONT_MIN_PX, baseFontSize * scale)).toFixed(3))}px`
}

function resetUiFontScaleInTree(root: HTMLElement) {
  for (const element of collectUiFontTargets(root)) {
    if (!element.dataset.uiFontBaseSize) continue
    restoreUiFontOriginalSize(element)
    delete element.dataset.uiFontBaseSize
    delete element.dataset.uiFontOriginalInlineSize
  }
}

function applyUiFontScaleInTree(root: HTMLElement, scale: number) {
  const targets = collectUiFontTargets(root)

  for (const element of targets) {
    if (element.dataset.uiFontBaseSize) restoreUiFontOriginalSize(element)
  }
  for (const element of targets) {
    rememberUiFontBaseSize(element)
  }
  for (const element of targets) {
    writeUiFontScaleToElement(element, scale)
  }
}

function scheduleUiFontScaleRefresh() {
  if (uiFontApplyPending || activeUiFontScale === UI_FONT_SCALE_DEFAULT) return
  uiFontApplyPending = true
  window.requestAnimationFrame(() => {
    uiFontApplyPending = false
    const appRoot = document.getElementById('root')
    if (!appRoot) return
    applyUiFontScaleInTree(appRoot, activeUiFontScale)
  })
}

function ensureUiFontObserver(root: HTMLElement) {
  if (uiFontObserver || typeof MutationObserver === 'undefined') return
  uiFontObserver = new MutationObserver(() => scheduleUiFontScaleRefresh())
  uiFontObserver.observe(root, { childList: true, subtree: true })
}

function stopUiFontObserver() {
  if (!uiFontObserver) return
  uiFontObserver.disconnect()
  uiFontObserver = null
}

function applyUiFontScale(value: number) {
  if (typeof document === 'undefined') return
  const scale = normalizeUiFontScale(value)
  const root = document.documentElement
  root.style.setProperty('--ui-font-scale', String(scale))
  root.dataset.uiFontScale = String(Math.round(scale * 100))

  const appRoot = document.getElementById('root')
  if (!appRoot) {
    window.requestAnimationFrame(() => applyUiFontScale(scale))
    return
  }

  if (scale === UI_FONT_SCALE_DEFAULT) {
    stopUiFontObserver()
    resetUiFontScaleInTree(appRoot)
    activeUiFontScale = UI_FONT_SCALE_DEFAULT
    return
  }

  applyUiFontScaleInTree(appRoot, scale)
  activeUiFontScale = scale
  ensureUiFontObserver(appRoot)
}

interface SettingsState {
  provider: AIProvider
  apiKey: string
  zhipuApiKey: string
  customProviderName: string
  customApiKey: string
  customBaseUrl: string
  providerConnections: Record<string, ProviderConnectionSettings>
  customProviderIds: string[]
  customUsageQuery: CustomUsageQuerySettings
  model: string
  fastResponses: boolean
  setFastResponses: (value: boolean) => void
  economyLessons: boolean
  setEconomyLessons: (value: boolean) => void
  storagePath: string
  storageLocationConfirmed: boolean
  githubToken: string
  isTeacher: boolean
  uiFontScale: number
  setProvider: (provider: AIProvider) => void
  setApiKey: (key: string) => void
  setZhipuApiKey: (key: string) => void
  setCustomProviderName: (name: string) => void
  setCustomApiKey: (key: string) => void
  setCustomBaseUrl: (url: string) => void
  setProviderConnection: (provider: AIProvider, value: Partial<ProviderConnectionSettings>) => void
  addCustomProvider: () => AIProvider
  removeCustomProvider: (provider: AIProvider) => void
  setCustomUsageQuery: (value: Partial<CustomUsageQuerySettings>) => void
  setModel: (model: string) => void
  setStoragePath: (path: string) => void
  setStorageLocationConfirmed: (value: boolean) => void
  setGithubToken: (token: string) => void
  setIsTeacher: (v: boolean) => void
  setUiFontScale: (value: number) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      provider: 'deepseek',
      apiKey: '',
      zhipuApiKey: '',
      customProviderName: '自定义供应商',
      customApiKey: '',
      customBaseUrl: '',
      providerConnections: defaultProviderConnections(),
      customProviderIds: [],
      customUsageQuery: {
        enabled: false,
        script: DEFAULT_CUSTOM_USAGE_SCRIPT,
      },
      model: PROVIDER_DEFAULT_MODEL.deepseek,
      fastResponses: true,
      setFastResponses: (fastResponses) => set({ fastResponses }),
      economyLessons: true,
      setEconomyLessons: (economyLessons) => set({ economyLessons }),
      storagePath: '',
      storageLocationConfirmed: false,
      githubToken: '',
      isTeacher: false,
      uiFontScale: UI_FONT_SCALE_DEFAULT,
      setProvider: (provider) => set({ provider }),
      setApiKey: (key) => set({ apiKey: key }),
      setZhipuApiKey: (key) => set({ zhipuApiKey: key }),
      setCustomProviderName: (name) => set(state => ({
        customProviderName: name,
        providerConnections: {
          ...state.providerConnections,
          custom: {
            ...getProviderConnection('custom', state),
            name,
          },
        },
      })),
      setCustomApiKey: (key) => set(state => ({
        customApiKey: key,
        providerConnections: {
          ...state.providerConnections,
          custom: {
            ...getProviderConnection('custom', state),
            apiKey: key,
          },
        },
      })),
      setCustomBaseUrl: (url) => set(state => ({
        customBaseUrl: url,
        providerConnections: {
          ...state.providerConnections,
          custom: {
            ...getProviderConnection('custom', state),
            baseUrl: url,
          },
        },
      })),
      setProviderConnection: (provider, value) => set(state => {
        const previous = getProviderConnection(provider, state)
        const next = {
          ...previous,
          ...value,
          usageQuery: {
            ...previous.usageQuery,
            ...value.usageQuery,
          },
        }
        const patch: Partial<SettingsState> = {
          providerConnections: {
            ...state.providerConnections,
            [provider]: next,
          },
        }
        if (provider === 'deepseek') patch.apiKey = next.apiKey
        if (provider === 'zhipu') patch.zhipuApiKey = next.apiKey
        if (provider === 'custom') {
          patch.customProviderName = next.name
          patch.customApiKey = next.apiKey
          patch.customBaseUrl = next.baseUrl
          patch.customUsageQuery = next.usageQuery ?? state.customUsageQuery
        }
        return patch
      }),
      addCustomProvider: () => {
        const id = `custom:${Date.now().toString(36)}`
        const makeName = (count: number) => (count <= 1 ? '自定义供应商' : `自定义供应商 ${count}`)
        set(state => ({
          provider: id,
          customProviderIds: Array.from(new Set([...(state.customProviderIds ?? []), id])),
          providerConnections: {
            ...state.providerConnections,
            [id]: createDefaultCustomConnection(makeName((state.customProviderIds?.length ?? 0) + 1)),
          },
          model: PROVIDER_DEFAULT_MODEL.custom,
        }))
        return id
      },
      removeCustomProvider: (provider) => set(state => {
        if (!isCustomProviderId(provider)) return {}
        const providerConnections = { ...state.providerConnections }
        delete providerConnections[provider]
        const customProviderIds = (state.customProviderIds ?? []).filter(id => id !== provider)
        const patch: Partial<SettingsState> = {
          providerConnections,
          customProviderIds,
          provider: state.provider === provider ? 'deepseek' : state.provider,
          model: state.provider === provider ? PROVIDER_DEFAULT_MODEL.deepseek : state.model,
        }
        if (provider === 'custom') {
          patch.customProviderName = '自定义供应商'
          patch.customApiKey = ''
          patch.customBaseUrl = ''
          patch.customUsageQuery = {
            enabled: false,
            script: DEFAULT_CUSTOM_USAGE_SCRIPT,
          }
        }
        return patch
      }),
      setCustomUsageQuery: (value) => set(state => ({
        customUsageQuery: {
          ...state.customUsageQuery,
          ...value,
        },
      })),
      setModel: (model) => set({ model }),
      setStoragePath: (path) => set({ storagePath: path }),
      setStorageLocationConfirmed: (storageLocationConfirmed) => set({ storageLocationConfirmed }),
      setGithubToken: (token) => set({ githubToken: token }),
      setIsTeacher: (v) => set({ isTeacher: v }),
      setUiFontScale: (value) => {
        const uiFontScale = normalizeUiFontScale(value)
        applyUiFontScale(uiFontScale)
        set({ uiFontScale })
      },
    }),
    {
      name: 'chillpass-settings',
      // v7：首次启动提示确认课件存储位置
      version: 7,
      migrate: (persisted) => {
        const state = persisted as Partial<SettingsState> | undefined
        if (state && typeof state.model === 'string') {
          state.model = normalizeModelId(state.model)
        }
        if (state) {
          state.uiFontScale = normalizeUiFontScale(state.uiFontScale)
          state.customProviderName = state.customProviderName || '自定义供应商'
          state.customApiKey = state.customApiKey || ''
          state.customBaseUrl = state.customBaseUrl || ''
          state.customUsageQuery = {
            enabled: state.customUsageQuery?.enabled === true,
            script: state.customUsageQuery?.script || DEFAULT_CUSTOM_USAGE_SCRIPT,
          }
          state.storageLocationConfirmed = Boolean(
            state.storageLocationConfirmed || state.storagePath,
          )
          const providerConnections = {
            ...defaultProviderConnections(),
            ...(state.providerConnections ?? {}),
          }
          providerConnections.deepseek = {
            ...providerConnections.deepseek,
            apiKey: state.apiKey || providerConnections.deepseek?.apiKey || '',
          }
          providerConnections.zhipu = {
            ...providerConnections.zhipu,
            apiKey: state.zhipuApiKey || providerConnections.zhipu?.apiKey || '',
          }
          const customProviderIds = Array.from(new Set(state.customProviderIds ?? []))
          const hasLegacyCustomConfig =
            Boolean(state.customApiKey || state.customBaseUrl)
            || state.customUsageQuery.enabled
            || state.provider === 'custom'
          const shouldKeepLegacyCustom = customProviderIds.includes('custom') || hasLegacyCustomConfig
          if (shouldKeepLegacyCustom) {
            providerConnections.custom = {
              ...createDefaultCustomConnection(state.customProviderName, state.customBaseUrl, state.customApiKey),
              ...(providerConnections.custom ?? {}),
              usageQuery: state.customUsageQuery,
            }
            if (!customProviderIds.includes('custom')) customProviderIds.unshift('custom')
          } else {
            delete providerConnections.custom
          }
          state.providerConnections = providerConnections
          state.customProviderIds = customProviderIds
          const validProviders = new Set([...BUILTIN_PROVIDER_IDS, ...(state.customProviderIds ?? [])])
          if (!validProviders.has(state.provider ?? '')) state.provider = 'deepseek'
        }
        return state as SettingsState
      },
      onRehydrateStorage: () => (state) => {
        applyUiFontScale(state?.uiFontScale ?? UI_FONT_SCALE_DEFAULT)
      },
    }
  )
)
