export interface CourseTextSource { sourceFile: string; text: string }

/** 恢复导入时保存的文件边界，使首页重试与首次导入使用完全相同的分段。 */
export function splitCourseText(text: string, fallbackSource: string): CourseTextSource[] {
  const markers = Array.from(text.matchAll(/===== 来源文件：(.+?) =====\r?\n/g))
  if (!markers.length) return [{ sourceFile: fallbackSource, text }]
  return markers.map((marker, index) => ({
    sourceFile: marker[1].trim(),
    text: text.slice((marker.index ?? 0) + marker[0].length, markers[index + 1]?.index ?? text.length).trim(),
  }))
}

/** 页码由解析器添加，不能把它当作 OCR 已成功识别的正文。 */
export function hasReadableBody(text: string): boolean {
  const pages = text.split(/--- 第 \d+ 页 ---/g)
  const content = pages.join('').replace(/--- 幻灯片 [^\n]+ ---/g, '').trim()
  if (!/[\p{L}\p{N}]/u.test(content)) return false
  // 多页扫描书的零星页码/水印也不算可用于学习的文字层。
  if (pages.length >= 4 && pages.every(page => page.replace(/\s/g, '').length < 20)) return false
  return true
}

/** 仅折叠同名、同正文的重复资料，不丢掉同名但内容不同的文件。 */
export function prepareTextSources(sources: CourseTextSource[]) {
  const seen = new Set<string>()
  const valid: CourseTextSource[] = []
  const skipped: string[] = []
  let duplicates = 0
  for (const source of sources) {
    const text = source.text.replace(/\r\n/g, '\n').trim()
    const key = `${source.sourceFile}\0${text}`
    if (seen.has(key)) { duplicates++; continue }
    seen.add(key)
    if (!hasReadableBody(text)) { skipped.push(source.sourceFile); continue }
    valid.push({ sourceFile: source.sourceFile, text })
  }
  return { valid, skipped, duplicates }
}
