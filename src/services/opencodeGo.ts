import { readAiEvents } from './aiResponse'

// Verified against https://opencode.ai/docs/go/ (2026-10-14).
// Go is a subscription authenticated by API key, NOT ChatGPT OAuth or Zen PAYG.
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/inference/go/v1'
export type GoProtocol = 'chat/completions' | 'responses' | 'messages'
const groups: Record<GoProtocol, string[]> = {
  'chat/completions': [
    'glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6',
    'longcat-2.0', 'deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp', 'mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.5',
    'mimo-v2.5-pro', 'hy4-preview', 'hy3', 'space-bunny', 'longcat-2.5-preview-free', 'step-5-preview-free',
  ],
  responses: ['grok-4.7', 'grok-4.6', 'gpt-6-luna', 'gpt-5.6-luna', 'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor'],
  messages: ['claude-haiku-5-5', 'minimax-m3', 'minimax-m2.7', 'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus'],
}
export const OPENCODE_GO_MODELS = Object.values(groups).flat()
export function isSupportedGoModel(model: string): boolean { return OPENCODE_GO_MODELS.includes(model) }
export function opencodeGoProtocol(model: string): GoProtocol {
  for (const [protocol, ids] of Object.entries(groups)) if (ids.includes(model)) return protocol as GoProtocol
  throw new Error(`尚未适配 OpenCode Go 模型 ${model} 的接口格式，请从已支持的模型目录选择。`)
}

export function toGoMessagesRequest(chat: any) {
  const blocks = (content: any): any[] => typeof content === 'string' ? [{ type: 'text', text: content }]
    : content.map((part: any) => {
      if (part.type !== 'image_url') return { type: 'text', text: part.text || '' }
      const url = part.image_url.url
      const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s.exec(url)
      if (url.startsWith('data:') && !match) throw new Error('该图片格式不受 Messages 接口支持。')
      return { type: 'image', source: match ? { type: 'base64', media_type: match[1], data: match[2] } : { type: 'url', url } }
    })
  const system = chat.messages.filter((message: any) => ['system', 'developer'].includes(message.role))
    .flatMap((message: any) => blocks(message.content)).filter((part: any) => part.type === 'text')
  return {
    model: chat.model,
    messages: chat.messages.filter((message: any) => !['system', 'developer'].includes(message.role))
      .map((message: any) => ({ role: message.role, content: blocks(message.content) })),
    ...(system.length ? { system } : {}),
    max_tokens: chat.max_tokens || 4096,
    stream: true,
    ...(typeof chat.temperature === 'number' ? { temperature: chat.temperature } : {}),
  }
}

export async function* readGoMessagesEvents(response: Response, signal?: AbortSignal): AsyncGenerator<any> {
  let input = 0, output = 0, reason = ''
  for await (const event of readAiEvents(response, signal)) {
    if (event.type === 'error') throw new Error(`OpenCode Go：${event.error?.message || '模型请求失败。'}`)
    if (event.type === 'message_start') {
      const usage = event.message?.usage
      input = (usage?.input_tokens || 0) + (usage?.cache_read_input_tokens || 0) + (usage?.cache_creation_input_tokens || 0)
      output = usage?.output_tokens || 0
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      yield { choices: [{ delta: { content: event.delta.text } }] }; continue
    } else if (event.type === 'message_delta') {
      reason = event.delta?.stop_reason || reason
      output = event.usage?.output_tokens ?? output
    } else if (event.type === 'message_stop') {
      yield { choices: [{ finish_reason: reason === 'max_tokens' ? 'length' : 'stop' }],
        incomplete: reason === 'max_tokens', incompleteReason: reason === 'max_tokens' ? 'max_output_tokens' : undefined,
        usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } }
      return
    }
    yield {} // Keep idle timers alive during thinking and heartbeat events.
  }
  throw new Error('OpenCode Go 响应中断，未收到完成事件。请重试。')
}
