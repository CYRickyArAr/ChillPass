import type { ExamPoint, Priority } from '../types'
import { normalizePointTitle, titleOverlap } from './lessonOrdering'

const priorityWeight: Record<Priority, number> = { must: 1.2, high: 1, know: 0.7 }
const weight = (point: ExamPoint) => (priorityWeight[point.priority] ?? 1)
  + Math.min(0.5, (point.description?.length ?? 0) / 600)
  + Math.min(0.4, (point.keyFormulas?.length ?? 0) * 0.1)

/** A workload estimate, not a limit or a claim about official exam requirements. */
export function recommendLessonCount(points: ExamPoint[]) {
  if (!points.length) return { min: 0, max: 0, suggested: 0 }
  const workload = points.reduce((sum, point) => sum + weight(point), 0)
  const min = Math.max(1, Math.ceil(workload / 2.4))
  const max = Math.max(min, Math.ceil(workload / 1.1))
  return { min, max, suggested: Math.max(min, Math.round((min + max) / 2)) }
}

export function parseLessonCount(input: string): number | null {
  if (!/^\d+$/.test(input.trim())) return null
  const count = Number(input)
  return Number.isSafeInteger(count) && count > 0 ? count : null
}

function terms(points: ExamPoint[]) {
  const text = points.map(point => `${point.title} ${point.description}`).join(' ').toLowerCase()
  return new Set(text.match(/[a-z]{3,}|[\p{Script=Han}]{2}/gu) ?? [])
}

function normalizeTitle(title?: string): string {
  return (title ?? '')
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/^\s*(第\s*)?\d{1,4}\s*[、.．\-_:：]?\s*/i, '')
    .replace(/^\s*(chapter|lecture|lesson|part)\s*\d{1,4}\s*[、.．\-_:：]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function inferGroupChapter(group: ExamPoint[]): string | undefined {
  const explicit = group
    .map(point => normalizeTitle(point.chapterTitle))
    .find(Boolean)
  if (explicit) return explicit

  const title = group.length === 1
    ? group[0].title
    : group.slice(0, 2).map(point => point.title).join(' / ')
  return normalizeTitle(title) || undefined
}

/** 两组之间存在先修关系时倾向合并到同一关，避免把依赖拆到前后两关。 */
function hasPrerequisiteLink(left: ExamPoint[], right: ExamPoint[]): boolean {
  const leftTitles = left.map(point => normalizePointTitle(point.title)).filter(Boolean)
  const rightTitles = right.map(point => normalizePointTitle(point.title)).filter(Boolean)
  const dependsOn = (source: ExamPoint[], targets: string[]) =>
    source.some(point => (point.prerequisites ?? []).some(raw => {
      const target = normalizePointTitle(raw)
      return Boolean(target) && targets.some(title => titleOverlap(target, title) >= 0.6)
    }))
  return dependsOn(left, rightTitles) || dependsOn(right, leftTitles)
}

/** Locally group adjacent source topics. No truncation and no extra long AI planning request. */
export function createLessonPlan(points: ExamPoint[], count: number): ExamPoint[] {
  if (!points.length || !Number.isSafeInteger(count) || count < 1) throw new Error('Invalid lesson count')
  const groups = points.map(point => [point])
  const tokens = groups.map(terms)
  // Keep source order and prefer merging similar topics with balanced unit sizes.
  while (groups.length > count) {
    let best = 0
    let bestScore = -Infinity
    for (let i = 0; i < groups.length - 1; i++) {
      const left = tokens[i], right = tokens[i + 1]
      const common = [...left].filter(term => right.has(term)).length
      const similarity = common / Math.max(1, left.size + right.size - common)
      const sameSource = groups[i][0].sourceFile === groups[i + 1][0].sourceFile
      const leftChapter = normalizeTitle(groups[i][0].chapterTitle)
      const rightChapter = normalizeTitle(groups[i + 1][0].chapterTitle)
      const sameChapter = Boolean(leftChapter && rightChapter && leftChapter === rightChapter)
      const linked = hasPrerequisiteLink(groups[i], groups[i + 1])
      const score = similarity + (sameSource ? 0.65 : 0) + (sameChapter ? 0.12 : 0) + (linked ? 0.3 : 0) - (groups[i].length + groups[i + 1].length) / points.length
      if (score > bestScore) { best = i; bestScore = score }
    }
    groups.splice(best, 2, [...groups[best], ...groups[best + 1]])
    tokens.splice(best, 2, new Set([...tokens[best], ...tokens[best + 1]]))
  }

  const parts = groups.map(() => 1)
  const weights = groups.map(group => group.reduce((sum, point) => sum + weight(point), 0))
  for (let remaining = count - groups.length; remaining > 0; remaining--) {
    let best = 0
    for (let i = 1; i < groups.length; i++) {
      if (weights[i] / parts[i] > weights[best] / parts[best]) best = i
    }
    parts[best]++
  }

  return groups.flatMap((group, groupIndex) => Array.from({ length: parts[groupIndex] }, (_, index) => {
    const total = parts[groupIndex]
    const priority = group.reduce((best, point) => priorityWeight[point.priority] > priorityWeight[best] ? point.priority : best, group[0].priority)
    const title = group.length === 1 ? group[0].title : `${group.slice(0, 2).map(point => point.title).join(' / ')}${group.length > 2 ? '…' : ''}`
    const chapterTitle = inferGroupChapter(group)
    return {
      ...group[0],
      id: `plan-${groupIndex + 1}-${index + 1}-${group[0].id}`,
      title: total > 1 ? `${title} (${index + 1}/${total})` : title,
      priority,
      description: group.map(point => `${point.title}：${point.description}`).join('\n'),
      coveredPoints: group,
      chapterTitle,
      keyFormulas: [...new Set(group.flatMap(point => point.keyFormulas ?? []))],
      pageRefs: [...new Set(group.flatMap(point => point.pageRefs ?? []))],
      ...(total > 1 ? { practiceSequence: { index: index + 1, total } } : {}),
    }
  }))
}
