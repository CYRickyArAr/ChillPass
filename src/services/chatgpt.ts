import { readAiEvents } from './aiResponse'
import { opencodeGoProtocol, toGoMessagesRequest, readGoMessagesEvents } from './opencodeGo'

export const CHATGPT_HEADERS = { 'Content-Type': 'application/json', 'X-ChillPass-Client': '1' }

export async function chatGPTJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/chatgpt${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: CHATGPT_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(path === '/logout' ? 45000 : 30000),
    cache: 'no-store',
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { throw new Error('无法连接 ChatGPT 本地后端，请重启 ChillPass（不要使用静态预览服务器）。') }
  if (!response.ok) {
    const detail = typeof data.error === 'string' ? data.error : data.error?.message || data.detail || text
    throw new Error(`${detail}${data.error?.code ? ` (${data.error.code})` : ''}`)
  }
  return data as T
}

/** Translate only the fields supported by this integration, not Chat Completions-only knobs. */
export function toResponsesRequest(chat: any) {
  return {
    model: chat.model,
    input: chat.messages.map((message: any) => ({
      role: message.role === 'system' ? 'developer' : message.role,
      content: typeof message.content === 'string' ? message.content : message.content.map((part: any) =>
        part.type === 'image_url'
          ? { type: 'input_image', image_url: part.image_url.url }
          : { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text },
      ),
    })),
    store: false,
    stream: true,
    ...(chat.max_tokens ? { max_output_tokens: chat.max_tokens } : {}),
    ...(['low', 'medium', 'high'].includes(chat.reasoning_effort) ? { reasoning: { effort: chat.reasoning_effort } } : {}),
    ...(chat.response_format?.type === 'json_object' ? { text: { format: { type: 'json_object' } } } : {}),
  }
}

export function aiRequestBody(provider: string, apiKey: string, payload: any, sessionId?: string): { headers: Record<string, string>; body: string } {
  const protocol = provider === 'chatgpt' ? 'responses' : provider === 'opencode-go' ? opencodeGoProtocol(payload.model) : 'chat/completions'
  const goHeaders: Record<string, string> = provider === 'opencode-go'
    ? { 'X-ChillPass-Client': '1', ...(sessionId ? { 'x-opencode-session': sessionId } : {}) } : {}
  return {
    headers: provider === 'chatgpt' ? CHATGPT_HEADERS
      : protocol === 'messages' ? { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...goHeaders }
      : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...goHeaders },
    body: JSON.stringify(protocol === 'responses' ? toResponsesRequest(payload) : protocol === 'messages' ? toGoMessagesRequest(payload) : payload),
  }
}

/** Normalize Responses SSE for existing consumers, but never accept a broken stream as success. */
export async function* readProviderEvents(response: Response, provider: string, signal?: AbortSignal, model?: string): AsyncGenerator<any> {
  const protocol = provider === 'chatgpt' ? 'responses' : provider === 'opencode-go' ? opencodeGoProtocol(model || '') : 'chat/completions'
  if (protocol === 'messages') { yield* readGoMessagesEvents(response, signal); return }
  if (protocol !== 'responses') { yield* readAiEvents(response, signal); return }
  const label = provider === 'opencode-go' ? 'OpenCode Go' : 'ChatGPT'
  let terminal = false
  for await (const event of readAiEvents(response, signal)) {
    if (event.type === 'response.output_text.delta') {
      yield { choices: [{ delta: { content: event.delta } }] }
    } else if (event.type === 'response.refusal.delta') {
      throw new Error(`${label} 拒绝了此请求：${event.delta || '请调整输入内容。'}`)
    } else if (event.type === 'response.failed' || event.type === 'error') {
      const error = event.response?.error || event.error || event
      throw new Error(`${label} 请求失败 (${error.code || 'unknown_error'})：${error.message || '请检查套餐用量或稍后重试。'}`)
    } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
      terminal = true
      const usage = event.response?.usage
      yield {
        choices: [{ finish_reason: event.type === 'response.completed' ? 'stop' : 'length' }],
        incomplete: event.type === 'response.incomplete',
        incompleteReason: event.response?.incomplete_details?.reason,
        usage: usage ? { prompt_tokens: usage.input_tokens ?? 0, completion_tokens: usage.output_tokens ?? 0, total_tokens: usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) } : undefined,
      }
      return
    } else {
      // Forward progress-only events so long reasoning phases reset the caller's idle timer.
      yield {}
    }
  }
  if (!terminal) throw new Error(`${label} 响应中断，未收到完成事件。请重试。`)
}
