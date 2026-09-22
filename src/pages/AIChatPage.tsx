import { memo, useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, ChangeEvent as ReactChangeEvent, CSSProperties } from 'react'
import { ArrowUp, ArrowDown, Trash2, Sparkles, X, Brain, Zap, Download, Upload, Plus, FileText, BookOpen, Calendar, MessageCircle, Shield, Waves, ChevronDown, Check, Square, Pencil, RefreshCw } from 'lucide-react'
import { useChatStore } from '@stores/chatStore'
import { useAthenaPanelStore } from '@stores/athenaPanelStore'
import AthenaPanelControls from '../components/athena/AthenaPanelControls'
import { useCurrentBundle } from '@stores/courseStore'
import { useAthenaStore } from '@stores/athenaStore'
import { useT } from '../i18n'
import type { TranslationKey } from '../i18n'
import { chatWithAthena, executeTask, summarizeAthenaInsights } from '@services/deepseek'
import { prepareImageForModel, mimeFromExtension } from '@services/imageService'
import { parseFile, cleanText } from '@services/fileParser'
import { storeFile } from '@services/browserFileStore'
import { BUILTIN_MODELS, modelVisionSupport } from '@services/modelCatalog'
import { useGlobalBlur } from '@utils/useGlobalBlur'
import { useSettingsStore } from '@stores/settingsStore'
import type { ChatMessage, AthenaAbility, AthenaMemory, AthenaTaskType, AthenaThinkingMode } from '@types/index'
import { renderMarkdownBlockCached, splitStreamingBlocks } from '../utils/markdown'
import styles from './AIChatPage.module.css'

// Athena 任务定义
const TASKS: { type: AthenaTaskType; icon: typeof MessageCircle; titleKey: TranslationKey; descKey: TranslationKey; color: string }[] = [
  { type: 'qa' as AthenaTaskType, icon: MessageCircle, titleKey: 'athena.taskQa', descKey: 'athena.taskQaDesc', color: '#0078D4' },
  { type: 'paper' as AthenaTaskType, icon: FileText, titleKey: 'athena.taskPaper', descKey: 'athena.taskPaperDesc', color: '#8B5CF6' },
  { type: 'report' as AthenaTaskType, icon: BookOpen, titleKey: 'athena.taskReport', descKey: 'athena.taskReportDesc', color: '#10B981' },
  { type: 'summary' as AthenaTaskType, icon: Sparkles, titleKey: 'athena.taskSummary', descKey: 'athena.taskSummaryDesc', color: '#F59E0B' },
  { type: 'plan' as AthenaTaskType, icon: Calendar, titleKey: 'athena.taskPlan', descKey: 'athena.taskPlanDesc', color: '#EF4444' },
]

// Athena 任务信息收集表单定义
const TASK_FORMS: Record<string, { labelKey: string; placeholderKey: string; required: boolean }[]> = {
  paper: [
    { labelKey: 'athena.fTopic', placeholderKey: 'athena.fTopicPh', required: true },
    { labelKey: 'athena.fWords', placeholderKey: 'athena.fWordsPh', required: true },
    { labelKey: 'athena.fLevel', placeholderKey: 'athena.fLevelPh', required: false },
    { labelKey: 'athena.fSpecial', placeholderKey: 'athena.fSpecialPh', required: false },
  ],
  report: [
    { labelKey: 'athena.fReportTopic', placeholderKey: 'athena.fReportTopicPh', required: true },
    { labelKey: 'athena.fReportType', placeholderKey: 'athena.fReportTypePh', required: true },
    { labelKey: 'athena.fWords', placeholderKey: 'athena.fWordsReportPh', required: false },
    { labelKey: 'athena.fSpecial', placeholderKey: 'athena.fSpecialReportPh', required: false },
  ],
  summary: [
    { labelKey: 'athena.fSummaryScope', placeholderKey: 'athena.fSummaryScopePh', required: true },
    { labelKey: 'athena.fSummaryFocus', placeholderKey: 'athena.fSummaryFocusPh', required: false },
    { labelKey: 'athena.fOutputFormat', placeholderKey: 'athena.fOutputFormatPh', required: false },
  ],
  plan: [
    { labelKey: 'athena.fExamDate', placeholderKey: 'athena.fExamDatePh', required: true },
    { labelKey: 'athena.fDailyTime', placeholderKey: 'athena.fDailyTimePh', required: true },
    { labelKey: 'athena.fWeakAreas', placeholderKey: 'athena.fWeakAreasPh', required: false },
    { labelKey: 'athena.fMastered', placeholderKey: 'athena.fMasteredPh', required: false },
  ],
}

/**
 * 弹窗容器：portal 到 body
 * 页面容器带 transform（创建层叠上下文），直接渲染在里面会导致：
 *   1) position: fixed 被该容器裁切（模糊/遮罩只覆盖内容区）
 *   2) 弹窗 z-index 只在容器内生效，会被 App 层级的全局模糊层盖住
 * portal 到 body 后弹窗脱离该容器，可正常居于模糊层之上
 */
function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(children, document.body)
}

/** 空消息数组常量：选择器返回稳定引用 */
const EMPTY_CHAT_MESSAGES: ChatMessage[] = []

/** 单条消息气泡：历史消息内容不变时不重复执行 Markdown/KaTeX/SVG 渲染。 */
/**
 * 单个已完成的段落。内容不变时 React 直接跳过重渲染，
 * 配合渲染缓存，流式期间只有新完成的段落需要真正解析一次。
 */
const StreamedBlock = memo(function StreamedBlock({ block }: { block: string }) {
  const html = useMemo(() => renderMarkdownBlockCached(block), [block])
  return <div dangerouslySetInnerHTML={{ __html: html }} />
})

/**
 * 流式内容的分段渲染：已完成的段落立刻按 Markdown 渲染，仍在生成的最后一段用纯文本。
 * 围栏代码块（```svg 等）在闭合前用代码块样式显示，避免把整段源码当正文平铺；
 * 闭合后立即成块渲染，图形不必等到整条回复结束才出现。
 */
const StreamingMessageContent = memo(function StreamingMessageContent({ content }: { content: string }) {
  const { blocks, pending, pendingInCodeBlock } = useMemo(() => splitStreamingBlocks(content), [content])
  return (
    <div className={styles.markdownContent}>
      {blocks.map((block, index) => (
        <StreamedBlock key={index} block={block} />
      ))}
      {pending &&
        (pendingInCodeBlock ? (
          <pre className={styles.streamSource}><code>{pending}</code></pre>
        ) : (
          <p className={styles.bubbleText}>{pending}</p>
        ))}
    </div>
  )
})

const MessageBubble = memo(function MessageBubble({
  message,
  isTyping,
  isStreamingContent,
  canEdit,
  onEdit,
  onRefresh,
}: {
  message: ChatMessage
  isTyping: boolean
  isStreamingContent: boolean
  canEdit?: boolean
  onEdit?: (message: ChatMessage) => void
  onRefresh?: (message: ChatMessage) => void
}) {
  const t = useT()
  const isUser = message.role === 'user'
  const renderedContent = useMemo(
    () =>
      !isUser && !isTyping && !isStreamingContent
        ? renderMarkdownBlockCached(message.content)
        : '',
    [isUser, isTyping, isStreamingContent, message.content],
  )

  if (isUser) {
    return (
      <div className={`${styles.messageRow} ${styles.messageRowUser}`}>
        <div className={`${styles.bubble} ${styles.bubbleUser}`}>
          {message.images && message.images.length > 0 && (
            <div className={styles.bubbleImages}>
              {message.images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={t('athena.attachedImage')}
                  className={styles.bubbleImage}
                />
              ))}
            </div>
          )}
          <p className={styles.bubbleText}>{message.content}</p>
        </div>
        {canEdit && (
          <div className={styles.messageActionRow}>
            <button
              type="button"
              className={styles.messageIconBtn}
              onClick={() => onEdit?.(message)}
              title="编辑并重新发送"
              aria-label="编辑并重新发送"
            >
              <Pencil size={15} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              className={styles.messageIconBtn}
              onClick={() => onRefresh?.(message)}
              title="重新生成"
              aria-label="重新生成"
            >
              <RefreshCw size={15} strokeWidth={1.9} />
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`${styles.messageRow} ${styles.messageRowAssistant}`}>
      <div className={`${styles.bubble} ${styles.bubbleAssistant} liquid-glass`}>
        {isTyping ? (
          <div className={styles.typingIndicator}>
            <span className={styles.typingDot} />
            <span className={styles.typingDot} />
            <span className={styles.typingDot} />
          </div>
        ) : isStreamingContent ? (
          <StreamingMessageContent content={message.content} />
        ) : (
          <div
            className={styles.markdownContent}
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
        )}
      </div>
    </div>
  )
})

const STREAM_RENDER_INTERVAL_MS = 80
const ATHENA_ATTACHMENT_TEXT_LIMIT = 18_000
const ATHENA_PARSEABLE_EXTS = new Set(['.pdf', '.ppt', '.pptx', '.doc', '.docx', '.txt', '.md'])
const ATHENA_TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.json', '.log', '.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.xml', '.py', '.java', '.c', '.cpp', '.h', '.hpp'])
const ATHENA_THINKING_OPTIONS: { value: AthenaThinkingMode; label: string; shortLabel: string }[] = [
  { value: 'off', label: '不思考', shortLabel: '无' },
  { value: 'low', label: '低思考', shortLabel: '低' },
  { value: 'medium', label: '中思考', shortLabel: '中' },
  { value: 'high', label: '高思考', shortLabel: '高' },
]

function athenaModelDisplayName(model: string) {
  const normalized = model.trim()
  const known: Record<string, string> = {
    'deepseek-flash': 'DeepSeek Flash',
    'deepseek-v4-pro': 'DeepSeek V4 Pro',
    'glm-5.3-flash': 'GLM Flash',
    'glm-5.3': 'GLM 5.3',
    'qwen-plus': 'Qwen Plus',
    'kimi-k2.7-code': 'Kimi K2.7',
    'doubao-seed-1-6': '豆包 1.6',
    'MiniMax-M2': 'MiniMax M2',
    'hunyuan-turbos-latest': '混元 Turbo',
    'ernie-4.5-turbo-128k': 'ERNIE 4.5',
  }
  return known[normalized] ?? normalized
}

type AthenaAttachment = {
  id: string
  name: string
  size: number
  type: string
  ext: string
  imageDataUrl?: string
  text?: string
  textTruncated?: boolean
  parseError?: string
}

function attachmentId() {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function extFromName(name: string) {
  const part = name.includes('.') ? name.split('.').pop() : ''
  return part ? `.${part.toLowerCase()}` : ''
}

function isImageFile(file: File) {
  return file.type.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif', '.svg'].includes(extFromName(file.name))
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function truncateAttachmentText(text: string) {
  const cleaned = cleanText(text)
  return {
    text: cleaned.slice(0, ATHENA_ATTACHMENT_TEXT_LIMIT),
    truncated: cleaned.length > ATHENA_ATTACHMENT_TEXT_LIMIT,
  }
}

function buildAttachmentContext(attachments: AthenaAttachment[]) {
  if (attachments.length === 0) return ''
  const lines: string[] = ['【用户附带的文件】']
  for (const attachment of attachments) {
    const kind = attachment.imageDataUrl ? '图片' : '文件'
    lines.push(`- ${kind}：${attachment.name}（${formatAttachmentSize(attachment.size)}）`)
    if (attachment.text) {
      lines.push(`  内容摘录：\n${attachment.text}${attachment.textTruncated ? '\n  ……（内容过长，已截断）' : ''}`)
    } else if (!attachment.imageDataUrl) {
      lines.push(`  说明：当前只能读取该文件的元信息${attachment.parseError ? `，内容解析失败：${attachment.parseError}` : ''}。`)
    }
  }
  return lines.join('\n')
}

/** Athena 唯一的聊天界面，由常驻侧栏承载，不再注册为独立页面。 */
export default function AIChatPage({ visible = true }: { visible?: boolean }) {
  const t = useT()
  const closePanel = useAthenaPanelStore(s => s.close)
  const isExpanded = useAthenaPanelStore(s => s.isExpanded)
  const exitExpanded = useAthenaPanelStore(s => s.exitExpanded)
  const pendingPrefill = useAthenaPanelStore(s => s.pendingPrefill)
  const consumePrefill = useAthenaPanelStore(s => s.consumePrefill)
  // 会话：消息从当前会话读取（引用稳定，避免重渲染抖动）
  const conversations = useChatStore(s => s.conversations)
  const currentId = useChatStore(s => s.currentId)
  const messages = useChatStore(s =>
    s.conversations.find(c => c.id === s.currentId)?.messages ?? EMPTY_CHAT_MESSAGES,
  )
  const isStreaming = useChatStore(s => s.isStreaming)
  const [historyWindow, setHistoryWindow] = useState({ id: currentId, start: Math.max(0, messages.length - 2) })
  const historyStart = historyWindow.id === currentId
    ? Math.min(historyWindow.start, Math.max(0, messages.length - 1))
    : Math.max(0, messages.length - 2)
  const historyAnchor = useRef<{ id: string; height: number; top: number } | null>(null)
  useEffect(() => {
    setHistoryWindow({ id: currentId, start: Math.max(0, messages.length - 2) })
    historyAnchor.current = null
  }, [currentId])
  const addMessage = useChatStore(s => s.addMessage)
  const updateMessage = useChatStore(s => s.updateMessage)
  const updateMessageAndTruncateAfter = useChatStore(s => s.updateMessageAndTruncateAfter)
  const setStreaming = useChatStore(s => s.setStreaming)
  const clearMessages = useChatStore(s => s.clearMessages)
  const createConversation = useChatStore(s => s.createConversation)
  const switchConversation = useChatStore(s => s.switchConversation)
  const deleteConversation = useChatStore(s => s.deleteConversation)
  const renameConversation = useChatStore(s => s.renameConversation)
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null)
  const [conversationName, setConversationName] = useState('')

  // 会话下拉开关
  const [convMenuOpen, setConvMenuOpen] = useState(false)
  const convMenuRef = useRef<HTMLDivElement>(null)
  const currentConversation = conversations.find(c => c.id === currentId)

  const bundle = useCurrentBundle()
  const rawText = bundle?.rawText ?? ''
  const currentCourse = bundle?.course

  // Athena store
  const abilities = useAthenaStore(s => s.abilities)
  const memories = useAthenaStore(s => s.memories)
  const addAutoAbility = useAthenaStore(s => s.addAutoAbility)
  const addAutoMemory = useAthenaStore(s => s.addAutoMemory)
  const athenaModel = useAthenaStore(s => s.model)
  const setAthenaModel = useAthenaStore(s => s.setModel)
  const thinkingMode = useAthenaStore(s => s.thinkingMode)
  const setThinkingMode = useAthenaStore(s => s.setThinkingMode)
  const provider = useSettingsStore(s => s.provider)
  const globalModel = useSettingsStore(s => s.model)
  const effectiveAthenaModel = athenaModel.trim() || globalModel
  const effectiveAthenaModelLabel = athenaModelDisplayName(effectiveAthenaModel)
  const thinkingLabel = ATHENA_THINKING_OPTIONS.find(option => option.value === thinkingMode)?.shortLabel ?? '高'
  const athenaModelOptions = useMemo(() => {
    const catalogKey = provider.startsWith('custom:') ? 'custom' : provider
    const ids = (BUILTIN_MODELS[catalogKey] ?? BUILTIN_MODELS.custom ?? [])
      .map(item => item.id)
      .filter(Boolean)
    // 保持模型目录原始顺序；当前/全局模型若不在目录中，只补到末尾，不因选中而顶到第一。
    return Array.from(new Set([...ids, globalModel, effectiveAthenaModel].filter(Boolean)))
  }, [provider, effectiveAthenaModel, globalModel])

  const input = useAthenaPanelStore(s => s.draft)
  const setInput = useAthenaPanelStore(s => s.setDraft)
  // 待发送附件：图片作为多模态内容交给模型；可解析文件会作为文本上下文附加
  const [attachments, setAttachments] = useState<AthenaAttachment[]>([])
  const [attachmentBusy, setAttachmentBusy] = useState(false)
  const [draggingAttachment, setDraggingAttachment] = useState(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const athenaConfigRef = useRef<HTMLDivElement>(null)
  const athenaConfigButtonRef = useRef<HTMLButtonElement>(null)
  const athenaConfigMenuRef = useRef<HTMLDivElement>(null)
  const dragDepthRef = useRef(0)
  const prevConversationIdRef = useRef<string | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const jumpAnimationRef = useRef<number | null>(null)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const streamBufferRef = useRef('')
  const streamFlushTimerRef = useRef<number | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const [streamingDraft, setStreamingDraft] = useState<{ id: string; content: string } | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)


  // Athena 任务与面板状态
  const [activeTask, setActiveTask] = useState<AthenaTaskType>('qa')
  const [showAbilityPanel, setShowAbilityPanel] = useState(false)
  const [showMemoryPanel, setShowMemoryPanel] = useState(false)
  const [athenaStatus, setAthenaStatus] = useState<'idle' | 'thinking' | 'tasking'>('idle')
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [taskFormFields, setTaskFormFields] = useState<{ labelKey: TranslationKey; placeholderKey: TranslationKey; required: boolean }[]>([])
  const [taskFormValues, setTaskFormValues] = useState<Record<string, string>>({})
  const [configMenuOpen, setConfigMenuOpen] = useState(false)
  const [configMenuStyle, setConfigMenuStyle] = useState<CSSProperties>({})

  // 错题本/旧链接只打开侧栏并预填，不离开当前学习页面。
  useEffect(() => {
    if (!visible || pendingPrefill === null) return
    const prefill = consumePrefill()
    if (prefill !== null) setInput(prefill)
  }, [visible, pendingPrefill, consumePrefill, setInput])

  useEffect(() => {
    if (!visible) {
      setConvMenuOpen(false)
      setShowAbilityPanel(false)
      setShowMemoryPanel(false)
      setShowTaskForm(false)
      return
    }
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [visible])

  useEffect(() => {
    setEditingMessageId(null)
  }, [currentId])

  const handleClosePanel = () => {
    closePanel()
    window.requestAnimationFrame(() => document.getElementById('athena-panel-toggle')?.focus())
  }

  const updateConfigMenuPosition = useCallback(() => {
    const button = athenaConfigButtonRef.current
    if (!button || typeof window === 'undefined') return

    const rect = button.getBoundingClientRect()
    const margin = 14
    const width = Math.min(340, window.innerWidth - margin * 2)
    const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin)
    const bottom = Math.max(margin, window.innerHeight - rect.top + 10)
    const maxHeight = Math.max(180, rect.top - margin * 2)

    setConfigMenuStyle({
      left,
      bottom,
      width,
      maxHeight,
    })
  }, [])

  // 自动滚动到底部：限频后的流式更新最多触发一次动画帧；用户上翻后停止抢滚动位置。
  const loadEarlierMessages = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container || historyStart === 0 || historyAnchor.current) return
    historyAnchor.current = { id: currentId, height: container.scrollHeight, top: container.scrollTop }
    shouldAutoScrollRef.current = false
    setHistoryWindow({ id: currentId, start: Math.max(0, historyStart - 20) })
  }, [currentId, historyStart])

  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container || container.clientHeight === 0) return
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 4
    if (jumpAnimationRef.current === null) shouldAutoScrollRef.current = atBottom
    setShowJumpToLatest(!atBottom)
  }, [])

  const cancelJumpToLatest = useCallback(() => {
    if (jumpAnimationRef.current !== null) {
      cancelAnimationFrame(jumpAnimationRef.current)
      jumpAnimationRef.current = null
    }
  }, [])

  useEffect(() => cancelJumpToLatest, [currentId, visible, cancelJumpToLatest])

  const jumpToLatest = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    cancelJumpToLatest()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'instant' })
      handleMessagesScroll()
      return
    }
    shouldAutoScrollRef.current = false
    const startTop = container.scrollTop
    const startedAt = performance.now()
    const step = (now: number) => {
      const progress = Math.min((now - startedAt) / 500, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const bottom = Math.max(0, container.scrollHeight - container.clientHeight)
      container.scrollTo({ top: startTop + (bottom - startTop) * eased, behavior: 'instant' })
      if (progress < 1) {
        jumpAnimationRef.current = requestAnimationFrame(step)
      } else {
        jumpAnimationRef.current = null
        handleMessagesScroll()
      }
    }
    jumpAnimationRef.current = requestAnimationFrame(step)
  }, [cancelJumpToLatest, handleMessagesScroll])

  useLayoutEffect(() => {
    const container = messagesContainerRef.current
    if (!container || !visible) return

    const conversationChanged = prevConversationIdRef.current !== currentId
    prevConversationIdRef.current = currentId
    if (conversationChanged) shouldAutoScrollRef.current = true
    const anchor = historyAnchor.current
    if (anchor?.id === currentId) {
      container.scrollTop = anchor.top + container.scrollHeight - anchor.height
      historyAnchor.current = null
    }
    // Browsing history must not be interrupted by incoming messages.
    if (shouldAutoScrollRef.current) container.scrollTop = container.scrollHeight
    handleMessagesScroll()
  }, [messages, historyStart, streamingDraft?.content, visible, isExpanded, currentId, handleMessagesScroll])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container || !visible) return
    // Images, panel resizing and a growing composer can change overflow without a scroll event.
    const observer = new ResizeObserver(() => {
      if (shouldAutoScrollRef.current) container.scrollTop = container.scrollHeight
      handleMessagesScroll()
    })
    observer.observe(container)
    if (container.firstElementChild) observer.observe(container.firstElementChild)
    return () => observer.disconnect()
  }, [visible, currentId, messages.length === 0, handleMessagesScroll])

  const cancelStreamFlush = useCallback(() => {
    if (streamFlushTimerRef.current !== null) {
      window.clearTimeout(streamFlushTimerRef.current)
      streamFlushTimerRef.current = null
    }
  }, [])

  const scheduleStreamRender = useCallback((id: string, content: string) => {
    streamBufferRef.current = content
    if (streamFlushTimerRef.current !== null) return
    streamFlushTimerRef.current = window.setTimeout(() => {
      streamFlushTimerRef.current = null
      setStreamingDraft({ id, content: streamBufferRef.current })
    }, STREAM_RENDER_INTERVAL_MS)
  }, [])

  useEffect(() => cancelStreamFlush, [cancelStreamFlush])

  // 弹窗打开时启用全局高斯模糊层（位于侧边栏与卡片之下）
  useGlobalBlur(showAbilityPanel || showMemoryPanel || showTaskForm)

  // 会话下拉：点击外部或 Esc 关闭
  useEffect(() => {
    if (!convMenuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (convMenuRef.current && !convMenuRef.current.contains(e.target as Node)) {
        setConvMenuOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConvMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [convMenuOpen])

  useEffect(() => {
    if (!configMenuOpen) return
    updateConfigMenuPosition()
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (athenaConfigRef.current?.contains(target) || athenaConfigMenuRef.current?.contains(target)) return
      setConfigMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfigMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', updateConfigMenuPosition)
    window.addEventListener('scroll', updateConfigMenuPosition, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', updateConfigMenuPosition)
      window.removeEventListener('scroll', updateConfigMenuPosition, true)
    }
  }, [configMenuOpen, updateConfigMenuPosition])

  // 宽度变化后重新测量实际输入；空白占位文字不参与高度计算。
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || !visible) return
    const resize = () => {
      if (textarea.clientWidth === 0) return
      textarea.style.height = '64px'
      textarea.style.height = `${input ? Math.max(64, Math.min(textarea.scrollHeight, 120)) : 64}px`
      textarea.style.overflowY = input && textarea.scrollHeight > textarea.clientHeight ? 'auto' : 'hidden'
    }
    resize()
    let lastWidth = textarea.clientWidth
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === lastWidth) return
      lastWidth = textarea.clientWidth
      resize()
    })
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [input, visible, isExpanded])

  const prepareAttachment = useCallback(async (file: File): Promise<AthenaAttachment> => {
    const ext = extFromName(file.name)
    const base: AthenaAttachment = {
      id: attachmentId(),
      name: file.name || t('athena.attachedFile'),
      size: file.size,
      type: file.type,
      ext,
    }

    if (isImageFile(file)) {
      try {
        return {
          ...base,
          imageDataUrl: await prepareImageForModel(file, mimeFromExtension(file.name)),
        }
      } catch (err) {
        return {
          ...base,
          parseError: err instanceof Error ? err.message : t('img.apiUnavailable'),
        }
      }
    }

    try {
      if (ATHENA_PARSEABLE_EXTS.has(ext)) {
        const stored = await storeFile(`athena_${base.id}`, file)
        const parsed = await parseFile(stored.path, stored.ext)
        const { text, truncated } = truncateAttachmentText(parsed)
        return { ...base, text, textTruncated: truncated }
      }

      if (file.type.startsWith('text/') || ATHENA_TEXT_EXTS.has(ext)) {
        const { text, truncated } = truncateAttachmentText(await file.text())
        return { ...base, text, textTruncated: truncated }
      }
    } catch (err) {
      return {
        ...base,
        parseError: err instanceof Error ? err.message : t('img.apiUnavailable'),
      }
    }

    return base
  }, [t])

  const addFilesAsAttachments = useCallback(async (files: Iterable<File>) => {
    if (isStreaming) return
    const selected = Array.from(files).filter(file => file.size > 0)
    if (selected.length === 0) return
    setAttachmentBusy(true)
    try {
      const prepared = await Promise.all(selected.map(file => prepareAttachment(file)))
      setAttachments(prev => [...prev, ...prepared])
      shouldAutoScrollRef.current = true
    } finally {
      setAttachmentBusy(false)
    }
  }, [isStreaming, prepareAttachment])

  const handleAttachmentPick = useCallback(
    async (e: ReactChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      e.target.value = ''
      if (!files || files.length === 0) return
      await addFilesAsAttachments(files)
    },
    [addFilesAsAttachments],
  )

  const handlePaste = useCallback((e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files).filter(file => file.size > 0)
    if (files.length === 0) return
    e.preventDefault()
    void addFilesAsAttachments(files)
  }, [addFilesAsAttachments])

  const hasDragFiles = (e: ReactDragEvent) =>
    Array.from(e.dataTransfer.types).includes('Files')

  const handleAttachmentDragEnter = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDragFiles(e) || isStreaming) return
    e.preventDefault()
    dragDepthRef.current += 1
    setDraggingAttachment(true)
  }, [isStreaming])

  const handleAttachmentDragOver = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDragFiles(e) || isStreaming) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [isStreaming])

  const handleAttachmentDragLeave = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDragFiles(e)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDraggingAttachment(false)
  }, [])

  const handleAttachmentDrop = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDragFiles(e) || isStreaming) return
    e.preventDefault()
    dragDepthRef.current = 0
    setDraggingAttachment(false)
    void addFilesAsAttachments(e.dataTransfer.files)
  }, [addFilesAsAttachments, isStreaming])

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(item => item.id !== id))
  }, [])

  const handleEditUserMessage = useCallback((message: ChatMessage) => {
    if (useChatStore.getState().isStreaming) return
    setEditingMessageId(message.id)
    setInput(message.content)
    setAttachments([])
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }, [setInput])

  const cancelEditing = useCallback(() => {
    setEditingMessageId(null)
    setInput('')
    setAttachments([])
  }, [setInput])

  const handleStopGeneration = useCallback(() => {
    streamAbortRef.current?.abort()
  }, [])

  // 发送消息
  const handleSend = useCallback(
    async (text?: string, resendMessage?: ChatMessage) => {
      const rawContent = (text ?? input).trim()
      const activeAttachments = resendMessage ? [] : attachments
      const hasAttachments = activeAttachments.length > 0 || Boolean(resendMessage?.images?.length)
      if ((!rawContent && !hasAttachments) || useChatStore.getState().isStreaming || attachmentBusy) return

      const targetMessageId = resendMessage?.id ?? editingMessageId
      const editingTargetIndex = targetMessageId
        ? messages.findIndex(m => m.id === targetMessageId && m.role === 'user')
        : -1
      const editingTarget = editingTargetIndex >= 0 ? messages[editingTargetIndex] : null
      const conversationId = useChatStore.getState().currentId!

      // 图片随消息一并发送给多模态模型
      const visibleAttachmentNames = activeAttachments.map(item => item.name).join('、')
      const content = rawContent || t('athena.attachmentOnlyPrompt').replace('{files}', visibleAttachmentNames)
      const attachmentContext = buildAttachmentContext(activeAttachments)
      const modelContent = attachmentContext ? `${content}\n\n${attachmentContext}` : content
      const newImages = activeAttachments.map(item => item.imageDataUrl).filter((url): url is string => Boolean(url))
      const images = editingTarget?.images
        ? [...editingTarget.images, ...newImages]
        : newImages

      if (!resendMessage) {
        setInput('')
        setAttachments([])
        setEditingMessageId(null)
      }

      // 构建对话历史（不包含当前消息，chatWithTutor 会自行追加）
      const historySource = editingTarget ? messages.slice(0, editingTargetIndex) : messages
      const history = historySource.map(m => ({
        role: m.role,
        content: m.content,
      }))

      const courseId = editingTarget?.courseId ?? currentCourse?.id

      if (editingTarget) {
        updateMessageAndTruncateAfter(editingTarget.id, content, conversationId, images.length > 0 ? images : undefined)
      } else {
        // 添加用户消息
        addMessage('user', content, courseId, images.length > 0 ? images : undefined)
      }

      // 添加空的 AI 消息，准备接收流式内容
      const assistantId = addMessage('assistant', '', courseId)
      streamBufferRef.current = ''
      setStreamingDraft({ id: assistantId, content: '' })
      shouldAutoScrollRef.current = true
      setStreaming(true)
      setAthenaStatus(activeTask !== 'qa' ? 'tasking' : 'thinking')
      const controller = new AbortController()
      streamAbortRef.current = controller
      let accumulated = ''

      try {
        const charterMemories = memories.filter(m => m.type === 'charter').map(m => m.content)
        const flowMemories = memories.filter(m => m.type === 'flow').map(m => m.content)
        const abilityList = abilities.map(a => ({ name: a.name, description: a.description }))

        // For task types other than 'qa', use executeTask
        if (activeTask !== 'qa') {
          for await (const chunk of executeTask(activeTask, modelContent, rawText, history, charterMemories, images, {
            model: effectiveAthenaModel,
            thinkingMode,
            signal: controller.signal,
          })) {
            accumulated += chunk
            scheduleStreamRender(assistantId, accumulated)
          }
        } else {
          for await (const chunk of chatWithAthena(modelContent, rawText, history, abilityList, charterMemories, flowMemories, images, {
            model: effectiveAthenaModel,
            thinkingMode,
            signal: controller.signal,
          })) {
            accumulated += chunk
            scheduleStreamRender(assistantId, accumulated)
          }
        }

        // 流式内容只在结束时写入持久化存储，避免每个片段序列化整段会话。
        const finalContent = accumulated || t('athena.noReply')
        cancelStreamFlush()
        updateMessage(assistantId, finalContent, conversationId)
        if (accumulated) {
          // After receiving the full reply, auto-summarize insights (non-blocking)
          summarizeAthenaInsights(modelContent, accumulated, abilities.map(a => a.name))
            .then(insights => {
              insights.newAbilities.forEach(a => addAutoAbility(a.name, a.description))
              insights.newMemories.forEach(m => addAutoMemory(m))
            })
            .catch(() => {})
        }
      } catch (err) {
        cancelStreamFlush()
        const aborted = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')
        if (aborted) {
          updateMessage(assistantId, accumulated || '已停止生成。', conversationId)
        } else {
          const errorMsg = err instanceof Error ? err.message : t('athena.unknownError')
          updateMessage(assistantId, t('athena.errorPrefix').replace('{msg}', errorMsg), conversationId)
        }
      } finally {
        cancelStreamFlush()
        if (streamAbortRef.current === controller) streamAbortRef.current = null
        setStreamingDraft(null)
        setStreaming(false)
        setAthenaStatus('idle')
      }
    },
    [input, messages, rawText, currentCourse, attachments, attachmentBusy, editingMessageId, activeTask, memories, abilities, effectiveAthenaModel, thinkingMode, addMessage, updateMessage, updateMessageAndTruncateAfter, setStreaming, addAutoAbility, addAutoMemory, scheduleStreamRender, cancelStreamFlush, t]
  )

  const handleRefreshUserMessage = useCallback((message: ChatMessage) => {
    if (useChatStore.getState().isStreaming) return
    void handleSend(message.content, message)
  }, [handleSend])

  // 键盘事件：Enter 发送，Shift+Enter 换行
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      handleSend()
    }
  }

  // 清空对话
  const handleClear = () => {
    if (isStreaming || messages.length === 0) return
    setEditingMessageId(null)
    clearMessages()
  }


  // 当前模型是否支持图片理解（未知则不提示，交给接口返回真实错误）
  const visionUnsupported = modelVisionSupport(effectiveAthenaModel) === 'no'

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !isStreaming && !attachmentBusy
  const canUseSendButton = isStreaming || canSend
  const canClear = messages.length > 0 && !isStreaming
  const canAttachFile = !isStreaming && !attachmentBusy

  return (
    <div
      className={`${styles.container} ${styles.sideChat} ${isExpanded ? styles.expandedChat : ''}`}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && !convMenuOpen && !showAbilityPanel && !showMemoryPanel && !showTaskForm) {
          event.preventDefault()
          event.stopPropagation()
          if (isExpanded) {
            exitExpanded()
            document.getElementById('athena-panel-expand')?.focus()
          } else {
            handleClosePanel()
          }
        }
      }}
    >
      {/* 顶部操作栏 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIcon}>
            <Sparkles size={20} strokeWidth={1.8} />
          </div>
          <div className={styles.headerText}>
            <h2 className={styles.title}>Athena</h2>
            {/* 会话管理：切换 / 新建 / 删除 */}
            <div className={styles.convSelect} ref={convMenuRef}>
              <button
                type="button"
                className={styles.convTrigger}
                onClick={() => setConvMenuOpen(o => !o)}
                aria-haspopup="listbox"
                aria-expanded={convMenuOpen}
                title={t('athena.conversation')}
              >
                <MessageCircle size={13} strokeWidth={2} />
                <span className={styles.convTriggerText}>
                  {currentConversation?.title || bundle?.course.name || t('athena.newChat')}
                </span>
                <ChevronDown size={13} strokeWidth={2} />
              </button>

              {convMenuOpen && (
                <div className={styles.convMenu} role="listbox">
                  <button
                    type="button"
                    className={styles.convNew}
                    disabled={isStreaming}
                    onClick={() => {
                      createConversation()
                      setConvMenuOpen(false)
                    }}
                  >
                    <Plus size={14} strokeWidth={2.2} />
                    <span>{t('athena.newChat')}</span>
                  </button>
                  <div className={styles.convList}>
                    {conversations.map(conv => (
                      <div
                        key={conv.id}
                        className={`${styles.convItem} ${conv.id === currentId ? styles.convItemActive : ''}`}
                      >
                        {renamingConversationId === conv.id ? (
                          <input
                            className={styles.convRenameInput}
                            aria-label="会话名称"
                            value={conversationName}
                            autoFocus
                            onFocus={e => e.currentTarget.select()}
                            onChange={e => setConversationName(e.target.value)}
                            onBlur={() => {
                              renameConversation(conv.id, conversationName)
                              setRenamingConversationId(null)
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                e.preventDefault()
                                e.currentTarget.blur()
                              }
                              if (e.key === 'Escape') {
                                e.stopPropagation()
                                setRenamingConversationId(null)
                              }
                            }}
                          />
                        ) : <button
                          type="button"
                          className={styles.convItemMain}
                          disabled={isStreaming}
                          onClick={() => {
                            switchConversation(conv.id)
                            setConvMenuOpen(false)
                          }}
                        >
                          <span className={styles.convItemTitle}>
                            {conv.title || t('athena.newChat')}
                          </span>
                          <span className={styles.convItemMeta}>
                            {t('athena.messageCount').replace('{count}', String(conv.messages.length))}
                          </span>
                        </button>}
                        <button
                          type="button"
                          className={styles.convRename}
                          title={renamingConversationId === conv.id ? '保存名称' : '重命名会话'}
                          aria-label={`${renamingConversationId === conv.id ? '保存名称' : '重命名会话'}：${conv.title || t('athena.newChat')}`}
                          onMouseDown={e => {
                            // 保持输入框焦点，让点击处理先保存退出，避免 blur 后再次进入编辑。
                            if (renamingConversationId === conv.id) e.preventDefault()
                          }}
                          onClick={() => {
                            if (renamingConversationId === conv.id) {
                              renameConversation(conv.id, conversationName)
                              setRenamingConversationId(null)
                              return
                            }
                            setConversationName(conv.title)
                            setRenamingConversationId(conv.id)
                          }}
                        >
                          <Pencil size={13} strokeWidth={1.9} />
                        </button>
                        <button
                          type="button"
                          className={styles.convDelete}
                          disabled={isStreaming}
                          title={t('athena.deleteChat')}
                          onClick={() => deleteConversation(conv.id)}
                        >
                          <Trash2 size={13} strokeWidth={1.9} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <p className={styles.subtitle}>
              {isStreaming
                ? t('athena.thinking')
                : currentCourse
                  ? t('athena.basedOn').replace('{course}', currentCourse.name)
                  : t('athena.subtitle')}
            </p>
          </div>
        </div>
        <div className={styles.headerTopActions}>
          {visible && <AthenaPanelControls />}
        </div>
        <div className={styles.statusIndicator}>
          <span className={`${styles.statusDot} ${styles[`status_${athenaStatus}`]}`} />
          <span className={styles.statusText}>
            {athenaStatus === 'thinking' ? t('athena.statusThinking') : athenaStatus === 'tasking' ? t('athena.statusTasking') : t('athena.idle')}
          </span>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.headerBtn}
            onClick={() => { createConversation(); setConvMenuOpen(false) }}
            disabled={isStreaming}
            title={t('athena.newChat')}
            aria-label={t('athena.newChat')}
          >
            <Plus size={18} strokeWidth={1.8} />
          </button>
          {messages.length > 0 && activeTask !== 'qa' && (
            <div className={styles.headerTaskBadge}>
              {t(TASKS.find(tk => tk.type === activeTask)?.titleKey || 'athena.taskQa' as TranslationKey)}
              <button onClick={() => setActiveTask('qa')}>
                <X size={10} strokeWidth={2.5} />
              </button>
            </div>
          )}
          <button className={styles.headerBtn} onClick={() => setShowAbilityPanel(true)} title={t('athena.abilities')}>
            <Zap size={16} strokeWidth={1.8} />
            <span className={styles.headerBtnLabel}>{abilities.length}</span>
          </button>
          <button className={styles.headerBtn} onClick={() => setShowMemoryPanel(true)} title={t('athena.memories')}>
            <Brain size={16} strokeWidth={1.8} />
            <span className={styles.headerBtnLabel}>{memories.length}</span>
          </button>
          <button
            className={`${styles.clearBtn} ${!canClear ? styles.clearBtnDisabled : ''}`}
            onClick={handleClear}
            disabled={!canClear}
            title={t('athena.clearChat')}
          >
            <Trash2 size={18} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {/* 消息区域 */}
      <div
        className={styles.messagesViewport}
      >
      <div
        className={styles.messagesArea}
        ref={messagesContainerRef}
          onScroll={e => {
            handleMessagesScroll()
            if (e.currentTarget.scrollTop < 80 && !shouldAutoScrollRef.current) loadEarlierMessages()
          }}
          onWheel={cancelJumpToLatest}
          onTouchStart={cancelJumpToLatest}
          onPointerDown={cancelJumpToLatest}
      >
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={`${styles.welcomeCard} liquid-glass`}>
              <div className={styles.welcomeIcon}>
                <Sparkles size={32} strokeWidth={1.6} />
              </div>
              <h3 className={styles.welcomeTitle}>Athena</h3>
              <p className={styles.welcomeSubtitle}>
                {t('athena.sidebarDescription')}
              </p>
              <div className={styles.taskGrid}>
                {TASKS.map(task => {
                  const Icon = task.icon
                  return (
                    <button
                      key={task.type}
                      className={`${styles.taskCard} ${activeTask === task.type ? styles.taskCardActive : ''}`}
                      onClick={() => {
                        setActiveTask(task.type)
                        if (task.type === 'qa') {
                          textareaRef.current?.focus()
                        } else {
                          setTaskFormFields(TASK_FORMS[task.type] as { labelKey: TranslationKey; placeholderKey: TranslationKey; required: boolean }[])
                          setTaskFormValues({})
                          setShowTaskForm(true)
                        }
                      }}
                    >
                      <div className={styles.taskIcon} style={{ color: task.color }}>
                        <Icon size={20} strokeWidth={1.8} />
                      </div>
                      <div className={styles.taskInfo}>
                        <span className={styles.taskTitle}>{t(task.titleKey)}</span>
                        <span className={styles.taskDesc}>{t(task.descKey)}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
              {activeTask !== 'qa' && (
                <div className={styles.activeTaskBadge}>
                  {t('athena.currentTask').replace('{task}', t(TASKS.find(tk => tk.type === activeTask)?.titleKey || 'athena.taskQa' as TranslationKey))}
                  <button onClick={() => setActiveTask('qa')}>
                    <X size={12} strokeWidth={2.5} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.messagesList}>
            {historyStart > 0 && (
              <button type="button" className={styles.convNew} onClick={loadEarlierMessages}>
                加载更早的消息（{historyStart}）
              </button>
            )}
            {messages.slice(historyStart).map((msg, index) => {
              const isCurrentStream = isStreaming && streamingDraft?.id === msg.id
              const displayMessage = isCurrentStream
                ? { ...msg, content: streamingDraft.content }
                : msg
              const isLast = historyStart + index === messages.length - 1
              const isTyping =
                isCurrentStream &&
                msg.role === 'assistant' &&
                displayMessage.content.length === 0 &&
                isLast
              return (
                <MessageBubble
                  key={msg.id}
                  message={displayMessage}
                  isTyping={isTyping}
                  isStreamingContent={isCurrentStream && !isTyping}
                  canEdit={msg.role === 'user' && !isStreaming}
                  onEdit={handleEditUserMessage}
                  onRefresh={handleRefreshUserMessage}
                />
              )
            })}
          </div>
        )}
      </div>

      {visible && messages.length > 0 && showJumpToLatest && (
        <button
          type="button"
          className={styles.jumpToLatest}
          onClick={jumpToLatest}
          aria-label="滚动到最新消息"
          title="滚动到最新消息"
        >
          <ArrowDown size={24} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
      </div>

      {/* 输入区域 */}
      <div
        className={`${styles.inputArea} ${draggingAttachment ? styles.inputAreaDragActive : ''}`}
        onDragEnter={handleAttachmentDragEnter}
        onDragOver={handleAttachmentDragOver}
        onDragLeave={handleAttachmentDragLeave}
        onDrop={handleAttachmentDrop}
      >
        {draggingAttachment && (
          <div className={styles.dropOverlay}>
            <Upload size={18} strokeWidth={1.9} />
            <span>{t('athena.dropAttachments')}</span>
          </div>
        )}

        {/* 附件预览 */}
        {(attachments.length > 0 || attachmentBusy) && (
          <div className={`${styles.imagePreview} ${styles.attachmentPreview} liquid-glass`}>
            <div className={styles.attachmentList}>
              {attachments.map(item => (
                <div key={item.id} className={styles.attachmentItem}>
                  {item.imageDataUrl ? (
                    <img
                      src={item.imageDataUrl}
                      alt={t('athena.attachedImage')}
                      className={styles.imageThumb}
                    />
                  ) : (
                    <div className={styles.attachmentFileIcon}>
                      <FileText size={18} strokeWidth={1.8} />
                    </div>
                  )}
                  <div className={styles.imagePreviewInfo}>
                    <div className={styles.attachmentName} title={item.name}>{item.name}</div>
                    <div className={styles.imagePreviewHint}>
                      {item.imageDataUrl
                        ? (visionUnsupported
                            ? t('athena.visionUnsupported').replace('{model}', effectiveAthenaModel)
                            : t('athena.imageDirectSend'))
                        : item.text
                          ? t('athena.fileTextReady')
                          : item.parseError
                            ? t('athena.fileMetaOnly')
                            : t('athena.fileMetaOnly')}
                    </div>
                    <div className={styles.attachmentSize}>{formatAttachmentSize(item.size)}</div>
                  </div>
                  <button
                    className={styles.removeImageBtn}
                    onClick={() => handleRemoveAttachment(item.id)}
                    title={t('athena.removeImage')}
                  >
                    <X size={14} strokeWidth={2.2} />
                  </button>
                </div>
              ))}
              {attachmentBusy && (
                <div className={styles.attachmentItem}>
                  <div className={styles.attachmentFileIcon}>
                    <Waves size={18} strokeWidth={1.8} className={styles.spin} />
                  </div>
                  <div className={styles.imagePreviewInfo}>
                    <div className={styles.attachmentName}>{t('athena.attachmentProcessing')}</div>
                    <div className={styles.imagePreviewHint}>{t('athena.attachmentProcessingHint')}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {editingMessageId && (
          <div className={styles.editingBar}>
            <span>正在编辑已发送消息，发送后将重新生成后续回复</span>
            <button type="button" onClick={cancelEditing}>取消</button>
          </div>
        )}

        <div className={`${styles.inputWrapper} liquid-glass`}>
          {/* 附件入口 */}
          <button
            className={`${styles.imageBtn} ${!canAttachFile ? styles.imageBtnDisabled : ''}`}
            onClick={() => fileInputRef.current?.click()}
            disabled={!canAttachFile}
            title={t('athena.addAttachment')}
          >
            <Plus size={20} strokeWidth={1.9} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleAttachmentPick}
          />
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={input}
            onChange={e => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            aria-label={t('athena.chatInputHint')}
            placeholder={
              isStreaming
                ? t('athena.thinkingPlaceholder')
                : activeTask !== 'qa'
                  ? t('athena.taskInputHint').replace('{task}', t(TASKS.find(tk => tk.type === activeTask)?.titleKey || 'athena.taskQa' as TranslationKey))
                  : t('athena.chatInputHint')
            }
            disabled={isStreaming}
            rows={1}
          />
          <div className={styles.athenaConfigControls} ref={athenaConfigRef}>
            <button
              ref={athenaConfigButtonRef}
              type="button"
              className={`${styles.athenaConfigTrigger} ${configMenuOpen ? styles.athenaConfigTriggerOpen : ''}`}
              onClick={() => {
                if (!configMenuOpen) updateConfigMenuPosition()
                setConfigMenuOpen(open => !open)
              }}
              disabled={isStreaming}
              aria-haspopup="menu"
              aria-expanded={configMenuOpen}
              title={`Athena：${effectiveAthenaModel} · ${ATHENA_THINKING_OPTIONS.find(option => option.value === thinkingMode)?.label ?? '高思考'}`}
            >
              <span className={styles.athenaTriggerModel}>{effectiveAthenaModelLabel}</span>
              <span className={styles.athenaTriggerThinking}>{thinkingLabel}</span>
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          {configMenuOpen && (
            <ModalPortal>
              <div
                ref={athenaConfigMenuRef}
                className={styles.athenaConfigMenu}
                role="menu"
                style={configMenuStyle}
              >
                <div className={styles.athenaConfigHeader}>
                  <div className={styles.athenaConfigHeaderText}>
                    <span className={styles.athenaConfigThinking}>{ATHENA_THINKING_OPTIONS.find(option => option.value === thinkingMode)?.label ?? '高思考'}</span>
                    <span className={styles.athenaConfigModel}>{effectiveAthenaModelLabel}</span>
                  </div>
                </div>
                <div className={styles.athenaThinkingGrid} aria-label="Athena 思考强度">
                  {ATHENA_THINKING_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      className={`${styles.athenaThinkingOption} ${thinkingMode === option.value ? styles.athenaThinkingOptionActive : ''}`}
                      onClick={() => setThinkingMode(option.value)}
                    >
                      {option.shortLabel}
                    </button>
                  ))}
                </div>
                <div className={styles.athenaModelMenuTitle}>选择模型</div>
                <div className={styles.athenaModelList}>
                  {athenaModelOptions.map(id => {
                    const active = id === effectiveAthenaModel
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`${styles.athenaModelOption} ${active ? styles.athenaModelOptionActive : ''}`}
                        onClick={() => {
                          setAthenaModel(id)
                        }}
                      >
                        <span className={styles.athenaModelOptionLabel}>{athenaModelDisplayName(id)}</span>
                        <span className={styles.athenaModelOptionId}>{id}</span>
                        {active && <Check size={16} strokeWidth={2.2} aria-hidden="true" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </ModalPortal>
          )}
          <button
            className={`${styles.sendBtn} ${!canUseSendButton ? styles.sendBtnDisabled : ''} ${isStreaming ? styles.stopBtn : ''}`}
            onClick={() => {
              if (isStreaming) {
                handleStopGeneration()
              } else {
                handleSend()
              }
            }}
            disabled={!canUseSendButton}
            title={isStreaming ? '停止生成' : t('athena.send')}
          >
            {isStreaming ? <Square size={15} strokeWidth={2.4} fill="currentColor" /> : <ArrowUp size={19} strokeWidth={2} />}
          </button>
        </div>
      </div>

      {/* Ability Panel */}
      {showAbilityPanel && (
        <ModalPortal>
        <div className={styles.modalOverlay} onClick={() => setShowAbilityPanel(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <Zap size={18} strokeWidth={2} />
                <h3>{t('athena.abilities')}</h3>
              </div>
              <button className={styles.modalClose} onClick={() => setShowAbilityPanel(false)}>
                <X size={18} strokeWidth={2} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <AbilityPanel />
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Memory Panel */}
      {showMemoryPanel && (
        <ModalPortal>
        <div className={styles.modalOverlay} onClick={() => setShowMemoryPanel(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <Brain size={18} strokeWidth={2} />
                <h3>{t('athena.memories')}</h3>
              </div>
              <button className={styles.modalClose} onClick={() => setShowMemoryPanel(false)}>
                <X size={18} strokeWidth={2} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <MemoryPanel />
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Task Form Modal */}
      {showTaskForm && (
        <ModalPortal>
        <div className={styles.modalOverlay} onClick={() => setShowTaskForm(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                {(() => { const Icon = TASKS.find(t => t.type === activeTask)?.icon || Sparkles; return <Icon size={18} strokeWidth={2} /> })()}
                <h3>{t(TASKS.find(tk => tk.type === activeTask)?.titleKey || 'athena.taskQa' as TranslationKey)} - {t('athena.infoCollect')}</h3>
              </div>
              <button className={styles.modalClose} onClick={() => setShowTaskForm(false)}>
                <X size={18} strokeWidth={2} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.taskForm}>
                {taskFormFields.map((field, i) => (
                  <div key={i} className={styles.formField}>
                    <label className={styles.formLabel}>
                      {t(field.labelKey)}
                      {field.required && <span className={styles.requiredMark}>*</span>}
                    </label>
                    <input
                      className={styles.panelInput}
                      placeholder={t(field.placeholderKey)}
                      value={taskFormValues[field.labelKey] || ''}
                      onChange={e => setTaskFormValues(prev => ({ ...prev, [field.labelKey]: e.target.value }))}
                    />
                  </div>
                ))}
                <button
                  className={styles.panelAddBtn}
                  onClick={() => {
                    // Build the prompt from form values
                    const prompt = taskFormFields
                      .map(f => `${t(f.labelKey)}：${taskFormValues[t(f.labelKey)] || t('athena.unspecified')}`)
                      .join('\n')
                    setInput(`${t('athena.taskPromptPrefix')}\n${prompt}`)
                    setShowTaskForm(false)
                    setTimeout(() => textareaRef.current?.focus(), 100)
                  }}
                >
                  <Sparkles size={16} strokeWidth={2} />
                  {t('athena.startTask')}
                </button>
              </div>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  )
}

/** 技能管理面板 */
function AbilityPanel() {
  const t = useT()
  const abilities = useAthenaStore(s => s.abilities)
  const addAbility = useAthenaStore(s => s.addAbility)
  const removeAbility = useAthenaStore(s => s.removeAbility)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')

  return (
    <div className={styles.panelContent}>
      <div className={styles.addForm}>
        <input
          className={styles.panelInput}
          placeholder={t('athena.abilityNamePlaceholder')}
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          className={styles.panelInput}
          placeholder={t('athena.abilityDescPlaceholder')}
          value={desc}
          onChange={e => setDesc(e.target.value)}
        />
        <button
          className={styles.panelAddBtn}
          onClick={() => {
            if (name.trim() && desc.trim()) {
              addAbility(name.trim(), desc.trim())
              setName('')
              setDesc('')
            }
          }}
        >
          <Plus size={16} strokeWidth={2} />
          {t('athena.add')}
        </button>
      </div>
      <div className={styles.itemList}>
        {abilities.length === 0 ? (
          <p className={styles.emptyHint}>{t('athena.noAbilitiesHint')}</p>
        ) : (
          abilities.map(a => (
            <div key={a.id} className={styles.abilityItem}>
              <div className={styles.abilityInfo}>
                <span className={styles.abilityName}>{a.name}</span>
                <span className={styles.abilityDesc}>{a.description}</span>
                {a.autoGenerated && <span className={styles.autoTag}>{t('athena.autoTag')}</span>}
              </div>
              <button className={styles.itemRemoveBtn} onClick={() => removeAbility(a.id)}>
                <Trash2 size={14} strokeWidth={1.8} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/** 记忆管理面板 */
function MemoryPanel() {
  const t = useT()
  const memories = useAthenaStore(s => s.memories)
  const addMemory = useAthenaStore(s => s.addMemory)
  const removeMemory = useAthenaStore(s => s.removeMemory)
  const updateMemory = useAthenaStore(s => s.updateMemory)
  const clearFlowMemories = useAthenaStore(s => s.clearFlowMemories)
  const exportAthena = useAthenaStore(s => s.exportAthena)
  const importAthena = useAthenaStore(s => s.importAthena)
  const [newCharter, setNewCharter] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const charterMemories = memories.filter(m => m.type === 'charter')
  const flowMemories = memories.filter(m => m.type === 'flow')

  const handleExport = () => {
    const data = exportAthena()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `athena-config-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: ReactChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        importAthena(data)
        alert(t('athena.importSuccess'))
      } catch {
        alert(t('dashboard.importFailedFormat'))
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className={styles.panelContent}>
      {/* Export / Import */}
      <div className={styles.dataActions}>
        <button className={styles.dataBtn} onClick={handleExport}>
          <Download size={14} strokeWidth={2} />
          {t('athena.export')}
        </button>
        <button className={styles.dataBtn} onClick={() => fileInputRef.current?.click()}>
          <Upload size={14} strokeWidth={2} />
          {t('athena.import')}
        </button>
        <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
      </div>

      {/* Charter Memories */}
      <div className={styles.memorySection}>
        <div className={styles.memorySectionHeader}>
          <Shield size={14} strokeWidth={2} />
          <h4>{t('athena.charterMemory')}</h4>
          <span className={styles.memoryCount}>{charterMemories.length}</span>
        </div>
        <p className={styles.memoryHint}>{t('athena.charterMemoryHint')}</p>
        <div className={styles.addForm}>
          <textarea
            className={styles.panelTextarea}
            placeholder={t('athena.addCharterMemory')}
            value={newCharter}
            onChange={e => setNewCharter(e.target.value)}
            rows={2}
          />
          <button
            className={styles.panelAddBtn}
            onClick={() => {
              if (newCharter.trim()) {
                addMemory('charter', newCharter.trim(), 'custom')
                setNewCharter('')
              }
            }}
          >
            <Plus size={16} strokeWidth={2} />
            {t('athena.add')}
          </button>
        </div>
        <div className={styles.itemList}>
          {charterMemories.map(m => (
            <div key={m.id} className={styles.memoryItem}>
              {editingId === m.id ? (
                <div className={styles.editForm}>
                  <textarea
                    className={styles.panelTextarea}
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    rows={3}
                  />
                  <div className={styles.editActions}>
                    <button onClick={() => { updateMemory(m.id, editText); setEditingId(null) }}>{t('common.save')}</button>
                    <button onClick={() => setEditingId(null)}>{t('common.cancel')}</button>
                  </div>
                </div>
              ) : (
                <>
                  <span className={styles.memoryCategory}>{m.category || t('athena.memCategoryCustom')}</span>
                  <p className={styles.memoryContent}>{m.content}</p>
                  <div className={styles.memoryActions}>
                    <button onClick={() => { setEditingId(m.id); setEditText(m.content) }}>
                      {t('athena.edit')}
                    </button>
                    <button onClick={() => removeMemory(m.id)}>
                      <Trash2 size={12} strokeWidth={1.8} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Flow Memories */}
      <div className={styles.memorySection}>
        <div className={styles.memorySectionHeader}>
          <Waves size={14} strokeWidth={2} />
          <h4>{t('athena.flowMemory')}</h4>
          <span className={styles.memoryCount}>{flowMemories.length}</span>
          {flowMemories.length > 0 && (
            <button className={styles.clearFlowBtn} onClick={clearFlowMemories}>
              {t('wrongbook.clear')}
            </button>
          )}
        </div>
        <p className={styles.memoryHint}>{t('athena.flowMemoryHint')}</p>
        <div className={styles.itemList}>
          {flowMemories.length === 0 ? (
            <p className={styles.emptyHint}>{t('athena.noFlowMemoriesHint')}</p>
          ) : (
            flowMemories.map(m => (
              <div key={m.id} className={styles.memoryItem}>
                <p className={styles.memoryContent}>{m.content}</p>
                <div className={styles.memoryActions}>
                  <button onClick={() => removeMemory(m.id)}>
                    <Trash2 size={12} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
