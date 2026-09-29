import { create } from 'zustand'
import { persist, type PersistStorage } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { useCourseStore } from './courseStore'
import { createConversationMemories } from './athenaStore'
import { athenaText } from '../utils/athenaText'
import { learningDataStorage } from '../services/learningDataStorage'
import type { ChatMessage, AthenaMemory, MemoryType } from '@types/index'

export interface Conversation {
  id: string
  title: string
  /** null = general/legacy unassigned. Never fall back to the currently open course. */
  courseId: string | null
  courseName?: string
  memories: AthenaMemory[]
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

const EMPTY_MESSAGES: ChatMessage[] = []
export const EMPTY_CONVERSATION_MEMORIES: AthenaMemory[] = []
function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 24 ? `${clean.slice(0, 24)}…` : clean
}
function makeConversation(courseId: string | null = useCourseStore.getState().currentCourseId || null): Conversation {
  const now = Date.now()
  const courseName = useCourseStore.getState().courses.find(c => c.course.id === courseId)?.course.name
  return { id: nanoid(), title: '新会话', courseId, courseName, memories: createConversationMemories(), messages: [], createdAt: now, updatedAt: now }
}

/** v0/v1 migration: preserve every conversation/message; only infer unambiguous course IDs.
 * Mixed-course and unstamped histories stay unassigned, never guessed from the current course/title.
 * Old global memories remain archived in athena-storage, not copied into unrelated sessions.
 */
export function migrateChat(persisted: unknown): { conversations: Conversation[]; currentId: string } {
  const old = persisted as { conversations?: Conversation[]; messages?: ChatMessage[]; currentId?: string } | undefined
  const existing = Array.isArray(old?.conversations) ? old.conversations
    : old?.messages?.length ? [{ ...makeConversation(null), messages: old.messages, title: deriveTitle(old.messages.find(m => m.role === 'user')?.content || '') }] : []
  const conversations = existing.map(conversation => {
    const ids = new Set(conversation.messages.map(message => message.courseId).filter((id): id is string => typeof id === 'string' && Boolean(id)))
    const courseId = typeof conversation.courseId === 'string' ? conversation.courseId : ids.size === 1 ? [...ids][0] : null
    return {
      ...conversation, courseId,
      courseName: conversation.courseName || useCourseStore.getState().courses.find(c => c.course.id === courseId)?.course.name,
      memories: Array.isArray(conversation.memories) ? conversation.memories : createConversationMemories(),
    }
  })
  return { conversations, currentId: conversations.some(c => c.id === old?.currentId) ? old!.currentId! : conversations[0]?.id || '' }
}

interface ChatState {
  conversations: Conversation[]
  currentId: string
  isStreaming: boolean
  getMessages: () => ChatMessage[]
  addMessage: (role: 'user' | 'assistant', content: string, courseId?: string, images?: string[], conversationId?: string) => string
  updateMessage: (id: string, content: string, conversationId?: string) => void
  updateMessageAndTruncateAfter: (id: string, content: string, conversationId?: string, images?: string[]) => void
  setStreaming: (streaming: boolean) => void
  clearMessages: () => void
  createConversation: (courseId?: string | null) => string
  renameConversation: (id: string, title: string) => void
  switchConversation: (id: string) => void
  deleteConversation: (id: string) => void
  addMemory: (conversationId: string, type: MemoryType, content: string, category?: string) => void
  addAutoMemory: (conversationId: string, content: unknown) => void
  removeMemory: (conversationId: string, id: string) => void
  updateMemory: (conversationId: string, id: string, content: string) => void
  clearFlowMemories: (conversationId: string) => void
  exportMemories: (conversationId: string) => { version: string; exportedAt: number; memories: AthenaMemory[] }
  importMemories: (conversationId: string, data: unknown) => void
}

type SavedChat = Pick<ChatState, 'conversations' | 'currentId'>
// Switching a conversation writes only a small ID, not all messages/images.
let savedConversations: Conversation[] | undefined
const chatStorage: PersistStorage<SavedChat> = {
  getItem: name => {
    const raw = learningDataStorage.getItem(name) as string | null
    if (!raw) return null
    const saved = JSON.parse(raw)
    const currentId = learningDataStorage.getItem(`${name}-current`) as string | null
    if (currentId && saved.state?.conversations?.some((c: Conversation) => c.id === currentId)) saved.state.currentId = currentId
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
      conversations: [], currentId: '', isStreaming: false,
      getMessages: () => get().conversations.find(c => c.id === get().currentId)?.messages ?? EMPTY_MESSAGES,
      addMessage: (role, content, _courseId, images, conversationId) => {
        const id = nanoid()
        set(state => {
          let conversations = state.conversations
          let target = conversations.find(c => c.id === (conversationId ?? state.currentId))
          if (!target) {
            if (conversationId) return state // Deleted target: never resurrect it or write into another session.
            target = makeConversation()
            conversations = [target, ...conversations]
          }
          const targetId = target.id
          const message: ChatMessage = { id, role, content, timestamp: Date.now(), courseId: target.courseId ?? undefined, ...(images?.length ? { images } : {}) }
          return {
            conversations: conversations.map(c => c.id !== targetId ? c : {
              ...c, title: role === 'user' && c.title === '新会话' ? deriveTitle(content) || c.title : c.title,
              messages: [...c.messages, message], updatedAt: Date.now(),
            }),
            currentId: conversationId ? state.currentId : targetId,
          }
        })
        return id
      },
      updateMessage: (id, content, conversationId) => set(state => ({
        conversations: state.conversations.map(c => c.id === (conversationId ?? state.currentId)
          ? { ...c, messages: c.messages.map(m => m.id === id ? { ...m, content } : m), updatedAt: Date.now() } : c),
      })),
      updateMessageAndTruncateAfter: (id, content, conversationId, images) => set(state => ({
        conversations: state.conversations.map(c => {
          if (c.id !== (conversationId ?? state.currentId)) return c
          const index = c.messages.findIndex(m => m.id === id)
          if (index < 0) return c
          const messages = c.messages.slice(0, index + 1)
          messages[index] = { ...messages[index], content, images: images?.length ? images : undefined }
          return { ...c, messages, updatedAt: Date.now() }
        }),
      })),
      setStreaming: (isStreaming) => set({ isStreaming }),
      clearMessages: () => set(state => ({ conversations: state.conversations.map(c => c.id === state.currentId ? { ...c, messages: [], updatedAt: Date.now() } : c) })),
      createConversation: (courseId) => {
        if (get().isStreaming) return get().currentId
        const conv = makeConversation(courseId)
        set(state => ({ conversations: [conv, ...state.conversations], currentId: conv.id }))
        return conv.id
      },
      renameConversation: (id, title) => {
        if (!title.trim()) return
        set(state => ({ conversations: state.conversations.map(c => c.id === id ? { ...c, title: title.trim(), updatedAt: Date.now() } : c) }))
      },
      switchConversation: (id) => {
        if (get().isStreaming || !get().conversations.some(c => c.id === id)) return
        set({ currentId: id })
      },
      deleteConversation: (id) => {
        if (get().isStreaming) return
        set(state => {
          const removed = state.conversations.find(c => c.id === id)
          if (!removed) return state
          const remaining = state.conversations.filter(c => c.id !== id)
          if (state.currentId !== id) return { conversations: remaining }
          const sibling = remaining.find(c => c.courseId === removed.courseId)
          if (sibling) return { conversations: remaining, currentId: sibling.id }
          const fresh = makeConversation(removed.courseId)
          return { conversations: [fresh, ...remaining], currentId: fresh.id }
        })
      },
      addMemory: (conversationId, type, content, category) => {
        const text = athenaText(content)
        if (!text.trim()) return
        const memory: AthenaMemory = { id: nanoid(), type, content: text, category, createdAt: Date.now(), updatedAt: Date.now() }
        set(state => ({ conversations: state.conversations.map(c => c.id === conversationId ? { ...c, memories: [...c.memories, memory] } : c) }))
      },
      addAutoMemory: (conversationId, content) => {
        const text = athenaText(content)
        const conversation = get().conversations.find(c => c.id === conversationId)
        if (!conversation || !text.trim() || conversation.memories.some(m => m.type === 'flow' && athenaText(m.content) === text)) return
        get().addMemory(conversationId, 'flow', text)
      },
      removeMemory: (conversationId, id) => set(state => ({ conversations: state.conversations.map(c => c.id === conversationId ? { ...c, memories: c.memories.filter(m => m.id !== id) } : c) })),
      updateMemory: (conversationId, id, content) => set(state => ({ conversations: state.conversations.map(c => c.id === conversationId ? { ...c, memories: c.memories.map(m => m.id === id ? { ...m, content: athenaText(content), updatedAt: Date.now() } : m) } : c) })),
      clearFlowMemories: (conversationId) => set(state => ({ conversations: state.conversations.map(c => c.id === conversationId ? { ...c, memories: c.memories.filter(m => m.type === 'charter') } : c) })),
      exportMemories: (conversationId) => ({ version: '2.0', exportedAt: Date.now(), memories: get().conversations.find(c => c.id === conversationId)?.memories ?? [] }),
      importMemories: (conversationId, data) => {
        const imported = (data as { memories?: unknown } | null)?.memories
        if (!Array.isArray(imported)) throw new Error('记忆格式不正确')
        const memories: AthenaMemory[] = imported.map(value => {
          if (!value || typeof value !== 'object' || !['charter', 'flow'].includes(value.type) || value.content == null) throw new Error('记忆格式不正确')
          return { ...value, id: nanoid(), content: athenaText(value.content), category: athenaText(value.category), createdAt: Number(value.createdAt) || Date.now(), updatedAt: Date.now() }
        })
        set(state => ({ conversations: state.conversations.map(c => c.id === conversationId ? { ...c, memories } : c) }))
      },
    }),
    { name: 'chillpass-chat', storage: chatStorage, version: 2, migrate: migrateChat,
      partialize: state => ({ conversations: state.conversations, currentId: state.currentId }),
    },
  ),
)
