import { marked } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { translate, type TranslationKey } from '../i18n/translations'
import { useLanguageStore } from '@stores/languageStore'

marked.setOptions({
  breaks: true,
  gfm: true,
})

/**
 * 使用占位符策略渲染数学公式：
 * 1. 先提取所有数学表达式，替换为唯一占位符
 * 2. 让 marked 解析剩余的 Markdown（不会破坏占位符）
 * 3. 将占位符替换回 KaTeX 渲染后的 HTML
 * 4. DOMPurify 消毒
 */

interface MathPlaceholder {
  id: string
  html: string
}

const BARE_FORMULA_RE = /(^|[ \t([{（,，。;；:：、])([A-Za-zΣ∑][A-Za-z0-9_()[\]{}.,+\-*/^=<>≤≥≈≠∑Σπ∞α-ωΑ-Ω\\ \t]{2,180})(?=$|[ \t)\]}）,，。;；:：、!?！？])/g

const MATH_IDENTIFIER_ALLOWLIST = new Set([
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'm', 'n', 'p', 'q', 's',
  't', 'u', 'v', 'w', 'x', 'y', 'z',
  'cos', 'dx', 'dy', 'exp', 'ln', 'log', 'max', 'mean', 'min', 'prob', 'probs', 'relu',
  'score', 'scores', 'sigmoid', 'sin', 'softmax', 'sqrt', 'std', 'sum', 'tan', 'var',
  'alpha', 'beta', 'gamma', 'lambda', 'loss', 'mu', 'sigma', 'theta',
  'batch', 'hidden', 'input', 'logit', 'logits', 'output', 'size',
])

const COMMON_MATH_FUNCTION_RE = /\b(?:softmax|sigmoid|relu|exp|log|ln|max|min|sum|sqrt|sin|cos|tan)\s*\(/i
const STRONG_MATH_SIGNAL_RE = /[=<>≤≥≈≠Σ∑]/

function shouldRenderBareMath(candidate: string): boolean {
  const text = candidate.trim()
  if (text.length < 4 || text.includes('://') || text.includes('@') || /[\u4e00-\u9fff]/.test(text)) {
    return false
  }
  if (!STRONG_MATH_SIGNAL_RE.test(text) && !COMMON_MATH_FUNCTION_RE.test(text)) {
    return false
  }

  const identifiers = text.match(/[A-Za-z]{2,}/g) ?? []
  const hasKnownMathName = identifiers.some(word => MATH_IDENTIFIER_ALLOWLIST.has(word.toLowerCase()))
  const hasSymbolicMath = /[Σ∑≤≥≈≠π∞α-ωΑ-Ω]/.test(text)
  const hasOnlyShortUnknowns = identifiers.every(word => (
    word.length <= 2 || MATH_IDENTIFIER_ALLOWLIST.has(word.toLowerCase())
  ))

  return hasSymbolicMath || hasKnownMathName || hasOnlyShortUnknowns
}

function findMatchingOpen(input: string, closeIndex: number, openChar: string, closeChar: string): number {
  let depth = 0
  for (let i = closeIndex; i >= 0; i--) {
    if (input[i] === closeChar) depth++
    if (input[i] === openChar) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function findMatchingClose(input: string, openIndex: number, openChar: string, closeChar: string): number {
  let depth = 0
  for (let i = openIndex; i < input.length; i++) {
    if (input[i] === openChar) depth++
    if (input[i] === closeChar) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function isTopLevelBoundary(char: string): boolean {
  return '=<>≤≥≈≠,+-*，,;；:：。'.includes(char)
}

function findTopLevelSlash(input: string): number {
  let paren = 0
  let brace = 0
  let bracket = 0
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (char === '\\') {
      i++
      while (i + 1 < input.length && /[A-Za-z]/.test(input[i + 1])) i++
      continue
    }
    if (char === '(') paren++
    else if (char === ')' && paren > 0) paren--
    else if (char === '{') brace++
    else if (char === '}' && brace > 0) brace--
    else if (char === '[') bracket++
    else if (char === ']' && bracket > 0) bracket--
    else if (char === '/' && paren === 0 && brace === 0 && bracket === 0) return i
  }
  return -1
}

function findFractionLeftStart(input: string, slashIndex: number): number {
  let i = slashIndex - 1
  while (i >= 0 && /\s/.test(input[i])) i--
  let paren = 0
  let brace = 0
  let bracket = 0
  for (; i >= 0; i--) {
    const char = input[i]
    if (char === ')') paren++
    else if (char === '(' && paren > 0) paren--
    else if (char === '}') brace++
    else if (char === '{' && brace > 0) brace--
    else if (char === ']') bracket++
    else if (char === '[' && bracket > 0) bracket--
    else if (paren === 0 && brace === 0 && bracket === 0 && isTopLevelBoundary(char)) return i + 1
  }
  return 0
}

function findFractionRightEnd(input: string, slashIndex: number): number {
  let i = slashIndex + 1
  while (i < input.length && /\s/.test(input[i])) i++
  let paren = 0
  let brace = 0
  let bracket = 0
  for (; i < input.length; i++) {
    const char = input[i]
    if (char === '\\') {
      while (i + 1 < input.length && /[A-Za-z]/.test(input[i + 1])) i++
      continue
    }
    if (char === '(') paren++
    else if (char === ')' && paren > 0) paren--
    else if (char === '{') brace++
    else if (char === '}' && brace > 0) brace--
    else if (char === '[') bracket++
    else if (char === ']' && bracket > 0) bracket--
    else if (paren === 0 && brace === 0 && bracket === 0 && (char === '/' || isTopLevelBoundary(char))) return i
  }
  return input.length
}

function expandSingleGroupOperand(input: string, start: number, end: number): { start: number; end: number } {
  let left = start
  let right = end
  while (/\s/.test(input[left] ?? '')) left++
  while (/\s/.test(input[right - 1] ?? '')) right--

  if (input[left] === '(' && findMatchingClose(input, left, '(', ')') === right - 1) {
    left++
    right--
  }
  if (input[right - 1] === ')' || input[right - 1] === '}' || input[right - 1] === ']') {
    const pairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' }
    const open = pairs[input[right - 1]]
    const matched = findMatchingOpen(input, right - 1, open, input[right - 1])
    if (matched >= left && matched < right) {
      const commandMatch = input.slice(left, matched).match(/\\[A-Za-z]+(?:\{[A-Za-z]+\})?$/)
      if (commandMatch) left = matched - commandMatch[0].length
    }
  }

  return { start: left, end: right }
}

function toLatexFractions(input: string): string {
  let output = input
  for (let pass = 0; pass < 4; pass++) {
    const slash = findTopLevelSlash(output)
    if (slash === -1) break

    const rawStart = findFractionLeftStart(output, slash)
    const rawEnd = findFractionRightEnd(output, slash)
    const { start } = expandSingleGroupOperand(output, rawStart, slash)
    const { end } = expandSingleGroupOperand(output, slash + 1, rawEnd)
    const numerator = output.slice(start, slash).trim()
    const denominator = output.slice(slash + 1, end).trim()
    if (!numerator || !denominator) break

    output = `${output.slice(0, start)}\\frac{${numerator}}{${denominator}}${output.slice(end)}`
  }
  return output
}

function normalizeBareMath(candidate: string): string {
  const latex = candidate
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([A-Za-z][A-Za-z0-9]*)\[([A-Za-z0-9_+\-]+)\]/g, '$1_{$2}')
    .replace(/\b([A-Za-z][A-Za-z0-9]*)\[([A-Za-z0-9_+\-]+)\)/g, '$1_{$2})')
    .replace(/\)\[([A-Za-z0-9_+\-]+)\]/g, ')_{$1}')
    .replace(/[Σ∑]\s*_\s*([A-Za-z0-9]+)/g, '\\sum_{$1}')
    .replace(/[Σ∑]\s+([A-Za-z0-9])(?=\s|$|\()/g, '\\sum_{$1}')
    .replace(/[Σ∑]\s*(?=(?:exp|softmax|sigmoid|relu|log|ln|max|min|sum|sqrt|sin|cos|tan)\s*\()/gi, '\\sum ')
    .replace(/[Σ∑]/g, '\\sum')
    .replace(/\bsoftmax\s*\(/gi, '\\operatorname{softmax}(')
    .replace(/\bsigmoid\s*\(/gi, '\\operatorname{sigmoid}(')
    .replace(/\brelu\s*\(/gi, '\\operatorname{ReLU}(')
    .replace(/\bexp\s*\(/gi, '\\exp(')
    .replace(/\blog\s*\(/gi, '\\log(')
    .replace(/\bln\s*\(/gi, '\\ln(')
    .replace(/\bmax\s*\(/gi, '\\max(')
    .replace(/\bmin\s*\(/gi, '\\min(')
    .replace(/\bsum\s*\(/gi, '\\sum(')
    .replace(/\bsqrt\s*\(/gi, '\\sqrt(')
    .replace(/≤/g, '\\le ')
    .replace(/≥/g, '\\ge ')
    .replace(/≈/g, '\\approx ')
    .replace(/≠/g, '\\ne ')

  return toLatexFractions(latex)
}

function shouldInlineMathScroll(math: string): boolean {
  return math.length > 28 || /[Σ∑]/.test(math) || (math.match(/=/g)?.length ?? 0) > 1
}

/** 提取并渲染所有数学表达式，返回替换后的文本和占位符映射 */
function extractAndRenderMath(text: string): { text: string; placeholders: MathPlaceholder[] } {
  const placeholders: MathPlaceholder[] = []
  let counter = 0

  const replace = (math: string, displayMode: boolean): string => {
    const id = `KATEXMATH${counter}ENDMATH`
    counter++
    const mathToRender = toLatexFractions(math)
    try {
      const html = katex.renderToString(mathToRender, {
        displayMode,
        throwOnError: false,
        output: 'htmlAndMathml',
      })
      const wrappedHtml = !displayMode && shouldInlineMathScroll(mathToRender)
        ? `<span class="mathInlineScroll">${html}</span>`
        : html
      placeholders.push({ id, html: wrappedHtml })
      return id
    } catch {
      return displayMode ? `$$${math}$$` : `$${math}$`
    }
  }

  // 顺序很重要：先处理 $$...$$ 和 \[...\]（块级），再处理 $...$ 和 \(...\)（行内）
  // 块级公式：$$...$$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => replace(math.trim(), true))
  // 块级公式：\[...\]
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, math) => replace(math.trim(), true))
  // 行内公式：$...$（不匹配跨行，不匹配空内容）
  text = text.replace(/\$([^\$\n]+?)\$/g, (_, math) => replace(math, false))
  // 行内公式：\(...\)
  text = text.replace(/\\\((.+?)\\\)/g, (_, math) => replace(math, false))
  // AI 偶尔会漏掉 $...$，这里补救常见数学表达式，如 softmax(s[i])=...、Σ_j exp(...)、M=max(s)
  text = text.replace(BARE_FORMULA_RE, (match, prefix: string, candidate: string) => {
    const math = candidate.trim()
    if (!shouldRenderBareMath(math)) return match

    const leadingSpace = candidate.match(/^[ \t]*/)?.[0] ?? ''
    const trailingSpace = candidate.match(/[ \t]*$/)?.[0] ?? ''
    return `${prefix}${leadingSpace}${replace(normalizeBareMath(math), false)}${trailingSpace}`
  })

  return { text, placeholders }
}

/** 将占位符替换回 KaTeX HTML */
function restoreMath(html: string, placeholders: MathPlaceholder[]): string {
  for (const p of placeholders) {
    // 占位符可能被 marked 包裹在 <p> 标签中，需要处理块级公式
    html = html.replace(new RegExp(`<p>\\s*${p.id}\\s*</p>`, 'g'), p.html)
    html = html.replace(new RegExp(p.id, 'g'), p.html)
  }
  return html
}

/* ===================== SVG 图形渲染 ===================== */

/**
 * 从 AI 回复中抽取 SVG
 * 匹配三类写法（AI 输出的围栏语言标签并不稳定，必须放宽）：
 *   1. 围栏代码块（```svg / ```xml / ```html / 任意标签，只要内容含 <svg>）
 *   2. 未闭合的围栏（回复被截断时没有收尾的 ```）
 *   3. 直接输出的裸 <svg>…</svg>
 */
const SVG_FENCE_RE = /```[^\n`]*\r?\n([\s\S]*?)(?:```|$)/g
const SVG_BARE_RE = /<svg[\s\S]*?<\/svg>/gi

/** SVG 消毒配置：仅允许图形相关标签/属性，脚本与事件处理器一律移除 */
const SVG_SANITIZE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'image', 'use', 'animate', 'set'],
  FORBID_ATTR: ['onload', 'onclick', 'onerror', 'href', 'xlink:href'],
}

/** HTML 转义（用于源码回显） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 消毒并渲染一个 SVG 片段，返回可直接插入的 HTML */
function renderSvgBlock(source: string): string {
  const cleaned = DOMPurify.sanitize(source, SVG_SANITIZE_CONFIG)
  const lang = useLanguageStore.getState().language
  const sourceLabel = translate(lang, 'chat.svgSource' as TranslationKey)

  // 消毒后没有 <svg> 说明内容不是有效图形，退回普通代码块展示
  if (!/<svg[\s>]/i.test(cleaned)) {
    return `<pre><code>${escapeHtml(source)}</code></pre>`
  }

  return (
    '<div class="svgBlock">' +
    `<div class="svgBlockCanvas">${cleaned}</div>` +
    '<details class="svgBlockSource">' +
    `<summary>${sourceLabel}</summary>` +
    `<pre><code>${escapeHtml(source)}</code></pre>` +
    '</details>' +
    '</div>'
  )
}

/**
 * 把 SVG 图形替换为占位符，避免被 marked 当作文本转义
 * 返回替换后的文本与「占位符 → HTML」映射
 */
function extractSvg(text: string): { text: string; svgs: MathPlaceholder[] } {
  const svgs: MathPlaceholder[] = []
  let counter = 0

  /** 内容确为 SVG 时替换为占位符 */
  const stash = (source: string): string => {
    // 只取 <svg>…</svg> 片段：未闭合围栏时捕获内容可能混入后续正文
    const match = source.match(/<svg[\s\S]*<\/svg>/i)
    const id = `CHARTSVG${counter}ENDSVG`
    counter++
    svgs.push({ id, html: renderSvgBlock((match ? match[0] : source).trim()) })
    return id
  }

  // 围栏代码块：只有内容确实是 SVG 才替换，否则原样返回整段（保留 ``` 标记）
  text = text.replace(SVG_FENCE_RE, (match, body: string) =>
    /<svg[\s>]/i.test(body) ? stash(body) : match,
  )
  // 直接输出的裸 <svg>
  text = text.replace(SVG_BARE_RE, match => stash(match))

  return { text, svgs }
}

export function renderMarkdown(content: string): string {
  if (!content) return ''

  // 1. 先抽取 SVG 图形（其中已单独消毒，避免被当作纯文本转义）
  const { text: textWithoutSvg, svgs } = extractSvg(content)

  // 2. 提取数学公式，替换为占位符
  const { text: textWithPlaceholders, placeholders } = extractAndRenderMath(textWithoutSvg)

  // 3. 解析 Markdown
  const rawHtml = marked.parse(textWithPlaceholders) as string

  // 4. 恢复数学公式与 SVG 图形
  const htmlWithMath = restoreMath(restoreMath(rawHtml, placeholders), svgs)

  // 5. 消毒（允许 KaTeX 与 SVG 所需的标签和属性）
  return DOMPurify.sanitize(htmlWithMath, {
    ADD_TAGS: ['span', 'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mroot', 'mtext', 'mspace', 'mtable', 'mtr', 'mtd', 'mover', 'munder', 'munderover', 'mstyle', 'merror', 'mpadded', 'mphantom', 'mfenced', 'msubsup', 'maligngroup', 'malignmark', 'maction', 'mlongdiv', 'mscarries', 'mscarry', 'msgroup', 'msline', 'msrow', 'mstack', 'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'marker', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'title', 'desc', 'details', 'summary', 'pre', 'code'],
    ADD_ATTR: ['class', 'style', 'aria-hidden', 'role', 'encoding', 'xmlns', 'viewBox', 'd', 'fill', 'height', 'width', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'transform', 'points', 'preserveAspectRatio', 'open', 'rx', 'ry', 'cx', 'cy', 'r', 'dx', 'dy', 'font-size', 'font-weight', 'font-family', 'text-anchor', 'dominant-baseline', 'marker-end', 'marker-start', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'offset', 'stop-color', 'stop-opacity', 'id'],
  })
}

/** 将 Markdown 内容渲染为安全的内联 HTML（不包裹 <p>，适合放在 span/按钮等内联元素中） */
export function renderInlineMarkdown(content: string): string {
  if (!content) return ''

  // 1. 提取数学公式，替换为占位符
  const { text: textWithPlaceholders, placeholders } = extractAndRenderMath(content)

  // 2. 解析内联 Markdown
  const rawHtml = marked.parseInline(textWithPlaceholders) as string

  // 3. 恢复数学公式
  const htmlWithMath = restoreMath(rawHtml, placeholders)

  // 4. 消毒
  return DOMPurify.sanitize(htmlWithMath, {
    ADD_TAGS: ['span', 'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mroot', 'mtext', 'mspace', 'mtable', 'mtr', 'mtd', 'mover', 'munder', 'munderover', 'mstyle', 'merror', 'mpadded', 'mphantom', 'mfenced', 'msubsup'],
    ADD_ATTR: ['class', 'style', 'aria-hidden', 'role', 'encoding', 'xmlns', 'viewBox', 'd', 'fill', 'height', 'width', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'transform', 'points', 'preserveAspectRatio', 'encoding'],
  })
}

/* ===================== 流式增量渲染 ===================== */

export interface StreamingSplit {
  /** 已完成、可以直接按 Markdown 渲染的段落。 */
  blocks: string[]
  /** 仍在生成的尾巴。若处于未闭合围栏内，这里已去掉 ``` 语言行，只剩源码。 */
  pending: string
  /** pending 是否处于未闭合的围栏代码块内。用于选择代码块样式而不是正文段落。 */
  pendingInCodeBlock: boolean
}

/**
 * 把流式内容切成「已完成的段落」和「仍在生成的尾巴」。
 *
 * 切分规则：
 * - 空行分段；
 * - 围栏（```）本身是块边界：围栏会打断段落，且围栏内容绝不能被拦腰切开；
 * - 围栏一旦闭合就立刻成块，不必等后面的空行，这样 SVG 等图形能马上渲染出来；
 * - 仍在围栏内的尾巴交给调用方用代码块样式显示，避免把整段源码当正文平铺。
 */
export function splitStreamingBlocks(content: string): StreamingSplit {
  const blocks: string[] = []
  let start = 0
  let inFence = false
  let fenceStart = -1

  const push = (from: number, to: number) => {
    const block = content.slice(from, to)
    if (block.trim()) blocks.push(block)
  }

  for (let i = 0; i < content.length; i++) {
    const atLineStart = i === 0 || content[i - 1] === '\n'
    if (atLineStart && content.startsWith('```', i)) {
      if (!inFence) {
        // 围栏开始：先把前面的内容收成一个块，尾巴从围栏行起算
        push(start, i)
        start = i
        fenceStart = i
        inFence = true
      } else {
        // 围栏结束：整段围栏已经完整，立刻交出（SVG 可马上出图）
        const lineEnd = content.indexOf('\n', i)
        const end = lineEnd === -1 ? content.length : lineEnd
        push(start, end)
        start = lineEnd === -1 ? content.length : lineEnd + 1
        // 围栏行后紧跟的空行属于分隔，一并跳过，避免尾巴以换行开头
        if (content[start] === '\n') start += 1
        fenceStart = -1
        inFence = false
        i = start - 1
        continue
      }
      i += 2
      continue
    }
    if (!inFence && content[i] === '\n' && content[i + 1] === '\n') {
      push(start, i)
      start = i + 2
      i++
    }
  }

  if (inFence) {
    // 仍在围栏内：剥掉开头的 ``` 语言行，只把源码交给代码块样式显示
    const firstLineEnd = content.indexOf('\n', fenceStart)
    return {
      blocks,
      pending: firstLineEnd === -1 ? '' : content.slice(firstLineEnd + 1),
      pendingInCodeBlock: true,
    }
  }
  return { blocks, pending: content.slice(start), pendingInCodeBlock: false }
}

const blockHtmlCache = new Map<string, string>()
const BLOCK_HTML_CACHE_LIMIT = 400

/**
 * 渲染单个已完成段落，并缓存结果。
 * 流式期间同一段落会被反复请求，缓存命中时跳过 marked/KaTeX/DOMPurify 的全部开销。
 */
export function renderMarkdownBlockCached(block: string): string {
  const key = `${useLanguageStore.getState().language}\u0000${block}`
  const cached = blockHtmlCache.get(key)
  if (cached !== undefined) return cached
  const html = renderMarkdown(block)
  // 缓存只服务于渲染过程，超出上限直接清空，避免长期占用内存。
  if (blockHtmlCache.size >= BLOCK_HTML_CACHE_LIMIT) blockHtmlCache.clear()
  blockHtmlCache.set(key, html)
  return html
}
