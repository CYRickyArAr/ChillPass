import { useLanguageStore } from '../stores/languageStore'

/** Only called after a user's explicit copy click. Never requests clipboard read permission. */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return } catch { /* Older browsers / denied permission: try selection copy. */ }
  }
  const focused = document.activeElement as HTMLElement | null
  const selection = window.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : []
  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('aria-label', 'Copy code')
  input.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0'
  document.body.appendChild(input)
  try {
    input.focus({ preventScroll: true })
    input.select()
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable')
  } finally {
    input.remove()
    focused?.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      for (const range of ranges) selection.addRange(range)
    }
  }
}

/** Delegation also handles cached Markdown and newly completed streaming blocks. */
export function setupCodeCopy(): () => void {
  const timers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()
  let disposed = false
  const onClick = async (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>('button[data-code-copy]')
    const block = button?.closest('.chillpassCodeBlock')
    const code = block?.querySelector(':scope > pre > code')
    if (!button || !code || button.disabled) return
    event.preventDefault()
    event.stopPropagation()
    clearTimeout(timers.get(button))
    timers.delete(button)
    button.disabled = true
    const chinese = useLanguageStore.getState().language === 'zh'
    try {
      await copyText(code.textContent ?? '')
      if (!disposed) button.textContent = chinese ? '已复制' : 'Copied'
    } catch {
      if (!disposed) button.textContent = chinese ? '复制失败，请手动选择' : 'Copy failed — select manually'
    } finally {
      button.disabled = false
      if (!disposed) {
        timers.set(button, setTimeout(() => {
          button.textContent = chinese ? '复制' : 'Copy'
          timers.delete(button)
        }, 2000))
      }
    }
  }
  document.addEventListener('click', onClick, true)
  return () => {
    disposed = true
    document.removeEventListener('click', onClick, true)
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }
}
