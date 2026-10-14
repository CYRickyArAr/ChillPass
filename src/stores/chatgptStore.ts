import { create } from 'zustand'
import { chatGPTJson } from '../services/chatgpt'
import { useSettingsStore } from './settingsStore'

export interface ChatGPTAccount { id: string; email: string; label: string; connected: boolean; planEnabled: boolean }
export interface ChatGPTStatus {
  activeId: string | null
  connected: boolean
  usageConnected: boolean
  planEnabled: boolean
  pending: boolean
  error: string
  accounts: ChatGPTAccount[]
}
export interface ChatGPTModel { id: string; name: string }

/** Deliberately NOT persisted. Only safe status/catalog data crosses the local API boundary. */
export const useChatGPTStore = create<ChatGPTStatus & { loaded: boolean; models: ChatGPTModel[]; modelError: string }>(() => ({
  loaded: false, activeId: null, connected: false, usageConnected: false, planEnabled: false, pending: false,
  error: '', accounts: [], models: [], modelError: '',
}))
let refreshPromise: Promise<void> | null = null
let modelRequest = 0

export async function loadChatGPTModels() {
  const request = ++modelRequest
  const expectedId = useChatGPTStore.getState().activeId
  try {
    const data = await chatGPTJson<{ models: ChatGPTModel[]; accountId: string }>('/models')
    if (request !== modelRequest || data.accountId !== expectedId || expectedId !== useChatGPTStore.getState().activeId) return
    useChatGPTStore.setState({ models: data.models, modelError: '' })
  } catch (error) {
    if (request === modelRequest) useChatGPTStore.setState({ models: [], modelError: error instanceof Error ? error.message : '模型列表加载失败。' })
  }
}

export function refreshChatGPTStatus(): Promise<void> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    const status = await chatGPTJson<ChatGPTStatus>('/status')
    const previous = useChatGPTStore.getState()
    const changed = !previous.loaded || status.activeId !== previous.activeId || status.connected !== previous.connected || status.planEnabled !== previous.planEnabled
    if (changed) {
      modelRequest++
      useChatGPTStore.setState({ models: [], modelError: '' })
      // A model from another account must not be silently reused.
      const settings = useSettingsStore.getState()
      const sameAccount = settings.providerConnections.chatgpt?.oauthAccountId === status.activeId
      settings.setProviderConnection('chatgpt', {
        oauthAccountId: status.activeId,
        ...(sameAccount ? {} : { model: '', enabledModels: undefined }),
        availableModels: [],
      })
      if (!sameAccount && settings.provider === 'chatgpt') settings.setModel('')
    }
    useChatGPTStore.setState({ ...status, loaded: true })
    if (changed && status.planEnabled) await loadChatGPTModels()
  })().finally(() => { refreshPromise = null })
  return refreshPromise
}
