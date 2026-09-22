import { create } from 'zustand'
import { persist, type PersistStorage } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { useCourseStore } from './courseStore'
import { learningDataStorage } from '../services/learningDataStorage'
import type { ChatMessage } from '@types/index'

/** 一次会话（一组消息） */
export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

/** 空数组常量：保证选择器返回稳定引用，避免无谓重渲染 */
const EMPTY_MESSAGES: ChatMessage[] = []

/** 由首条用户消息推导会话标题 */
function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean.length > 24 ? `${clean.slice(0, 24)}…` : clean
}

/** 创建空会话 */
function makeConversation(): Conversation {
  const now = Date.now()
  const state = useCourseStore.getState()
  const title = state.courses.find(c => c.course.id === state.currentCourseId)?.course.name || '新会话'
  return { id: nanoid(), title, messages: [], createdAt: now, updatedAt: now }
}

interface ChatState {
  conversations: Conversation[]
  currentId: string
  isStreaming: boolean

  /** 当前会话的消息（组件通过选择器读取，引用稳定） */
  getMessages: () => ChatMessage[]
  addMessage: (role: 'user' | 'assistant', content: string, courseId?: string, images?: string[]) => string
  /** 可显式指定会话，避免流式回复在切换会话后写入错误位置。 */
  updateMessage: (id: string, content: string, conversationId?: string) => void
  /** 更新某条用户消息，并删除其后的旧回复，用于“编辑重发”。 */
  updateMessageAndTruncateAfter: (id: string, content: string, conversationId?: string, images?: string[]) => void
  setStreaming: (streaming: boolean) => void
  /** 清空当前会话的消息 */
  clearMessages: () => void
  /** 新建会话并切换过去，返回新会话 id */
  createConversation: () => string
  renameConversation: (id: string, title: string) => void
  /** 切换会话 */
  switchConversation: (id: string) => void
  /** 删除会话（删空后自动补一个空会话） */
  deleteConversation: (id: string) => void
}

type SavedChat = Pick<ChatState, 'conversations' | 'currentId'>
// 切换会话只写一个小 ID，不重复序列化全部消息和图片。
let savedConversations: Conversation[] | undefined
const chatStorage: PersistStorage<SavedChat> = {
  getItem: name => {
    const raw = learningDataStorage.getItem(name) as string | null
    if (!raw) return null
    const saved = JSON.parse(raw)
    const currentId = learningDataStorage.getItem(`${name}-current`) as string | null
    if (currentId && saved.state?.conversations?.some((c: Conversation) => c.id === currentId)) {
      saved.state.currentId = currentId
    }
    savedConversations = saved.state?.conversations
    return saved
  },
  setItem: (name, value) => {
    if (savedConversations !== value.state.conversations) {
      learningDataStorage.setItem(name, JSON.stringify(value))
      savedConversations = value.state.conversations
    }
    learningDataStorage.setItem(`${name}-current`, value.state.currentId)
  },
  removeItem: name => {
    learningDataStorage.removeItem(name)
    learningDataStorage.removeItem(`${name}-current`)
    savedConversations = undefined
  },
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      currentId: '',
      isStreaming: false,

      getMessages: () => {
        const { conversations, currentId } = get()
        return conversations.find(c => c.id === currentId)?.messages ?? EMPTY_MESSAGES
      },

      addMessage: (role, content, courseId, images) => {
        const id = nanoid()
        const message: ChatMessage = {
          id,
          role,
          content,
          timestamp: Date.now(),
          courseId,
          ...(images && images.length > 0 ? { images } : {}),
        }
        set(state => {
          // 兜底：尚无任何会话时自动建立一个
          const conversations = state.conversations.length > 0
            ? state.conversations
            : [makeConversation()]
          const currentId = state.currentId || conversations[0].id

          return {
            conversations: conversations.map(c => {
              if (c.id !== currentId) return c
              const title = c.title || makeConversation().title
              return {
                ...c,
                title,
                messages: [...c.messages, message],
                updatedAt: Date.now(),
              }
            }),
            currentId,
          }
        })
        return id
      },

      updateMessage: (id, content, conversationId) => {
        set(state => ({
          conversations: state.conversations.map(c =>
            c.id === (conversationId ?? state.currentId)
              ? {
                  ...c,
                  messages: c.messages.map(m => (m.id === id ? { ...m, content } : m)),
                  updatedAt: Date.now(),
                }
              : c,
          ),
        }))
      },

      updateMessageAndTruncateAfter: (id, content, conversationId, images) => {
        set(state => ({
          conversations: state.conversations.map(c => {
            if (c.id !== (conversationId ?? state.currentId)) return c
            const index = c.messages.findIndex(m => m.id === id)
            if (index < 0) return c
            const messages = c.messages.slice(0, index + 1)
            messages[index] = {
              ...messages[index],
              content,
              ...(images && images.length > 0 ? { images } : { images: undefined }),
            }
            return {
              ...c,
              messages,
              updatedAt: Date.now(),
            }
          }),
        }))
      },

      setStreaming: (streaming) => set({ isStreaming: streaming }),

      clearMessages: () => {
        set(state => ({
          conversations: state.conversations.map(c =>
            c.id === state.currentId ? { ...c, messages: [], updatedAt: Date.now() } : c,
          ),
        }))
      },

      createConversation: () => {
        const conv = makeConversation()
        set(state => ({
          conversations: [conv, ...state.conversations],
          currentId: conv.id,
        }))
        return conv.id
      },

      renameConversation: (id, title) => {
        const name = title.trim()
        if (!name) return
        set(state => ({ conversations: state.conversations.map(c =>
          c.id === id ? { ...c, title: name, updatedAt: Date.now() } : c,
        ) }))
      },

      switchConversation: (id) => {
        if (!get().conversations.some(c => c.id === id)) return
        set({ currentId: id })
      },

      deleteConversation: (id) => {
        set(state => {
          const remaining = state.conversations.filter(c => c.id !== id)
          if (remaining.length === 0) {
            const fresh = makeConversation()
            return { conversations: [fresh], currentId: fresh.id }
          }
          const currentId = state.currentId === id ? remaining[0].id : state.currentId
          return { conversations: remaining, currentId }
        })
      },
    }),
    {
      name: 'chillpass-chat',
      storage: chatStorage,
      // v1：旧数据只有单个 messages 数组，迁移为「一个会话」
      version: 1,
      migrate: (persisted) => {
        const legacy = (persisted as { messages?: ChatMessage[] } | undefined)?.messages ?? []
        const conv = makeConversation()
        conv.messages = legacy
        conv.title = deriveTitle(legacy.find(m => m.role === 'user')?.content ?? '')
        return { conversations: [conv], currentId: conv.id }
      },
      // 只持久化会话与当前会话 id（isStreaming 刷新后总是 false）
      partialize: (state) => ({ conversations: state.conversations, currentId: state.currentId }),
    },
  ),
)
