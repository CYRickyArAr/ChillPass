/** Parse SSE incrementally (including UTF-8/event boundaries); accept JSON-only compatible servers. */
export async function* readAiEvents(response: Response, signal?: AbortSignal): AsyncGenerator<any> {
  if (response.headers.get('content-type')?.includes('application/json')) {
    yield await response.json()
    return
  }
  if (!response.body) throw new Error('Missing AI response body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { value, done } = await reader.read()
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      buffer += decoder.decode(value, { stream: !done })
      if (done && buffer && !buffer.endsWith('\n')) buffer += '\n'
      if (done) buffer += '\n'
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
        else if (!line && data.length) {
          const payload = data.join('\n')
          data = []
          if (payload === '[DONE]') return
          const event = JSON.parse(payload)
          if (event.error) throw new Error(String(event.error.message || 'AI stream error'))
          yield event
        }
      }
      if (done) return
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
