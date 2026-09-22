import type { ExamPoint } from '../types'

const PUNCTUATION = /[（）()【】\[\]{}《》〈〉""''""''：:，,。.!！？?；;、\s_\-—–/\\|·]+/g

/** 归一化考点标题，用于把 prerequisites 中的名称匹配回实际考点。 */
export function normalizePointTitle(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(PUNCTUATION, '')
}

/** 两个标题的匹配度，用于把前置名称解析回实际考点。 */
export function titleOverlap(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  const shorter = left.length <= right.length ? left : right
  const longer = left.length <= right.length ? right : left
  if (shorter.length >= 3 && longer.includes(shorter)) return 0.95
  const setA = new Set(left.split(''))
  const setB = new Set(right.split(''))
  let common = 0
  for (const character of setA) if (setB.has(character)) common++
  return common / Math.max(1, Math.min(setA.size, setB.size))
}

/**
 * 把每个考点的 prerequisites 解析为实际考点下标。
 * 只有匹配度足够高的名称才建立依赖，避免把同义描述误判成前置关系。
 */
function resolveDependencies(points: ExamPoint[]): Array<Set<number>> {
  const titles = points.map(point => normalizePointTitle(point.title))
  const dependencies = points.map(() => new Set<number>())

  points.forEach((point, index) => {
    for (const raw of point.prerequisites ?? []) {
      const target = normalizePointTitle(raw)
      if (!target) continue
      let bestIndex = -1
      let bestScore = 0
      titles.forEach((title, candidate) => {
        if (candidate === index || !title) return
        const score = titleOverlap(target, title)
        if (score > bestScore) {
          bestScore = score
          bestIndex = candidate
        }
      })
      if (bestIndex >= 0 && bestScore >= 0.6) dependencies[index].add(bestIndex)
    }
  })

  return dependencies
}

/**
 * 按先修关系稳定排序：前置考点排在其依赖者之前。
 * 无依赖或依赖不明确时保持原有课件顺序；出现环时剩余考点保持原序，不抛错。
 */
export function orderExamPointsByDependency(points: ExamPoint[]): ExamPoint[] {
  if (points.length < 2) return points
  const dependencies = resolveDependencies(points)
  if (dependencies.every(set => set.size === 0)) return points

  const remaining = points.map((_, index) => index)
  const resolved = new Set<number>()
  const order: number[] = []

  while (remaining.length > 0) {
    // 每次只取原顺序中最靠前且前置已满足的考点，尽量少打乱课件本身的次序。
    const picked = remaining.find(index => [...dependencies[index]].every(dependency => resolved.has(dependency)))
    if (picked === undefined) {
      order.push(...remaining)
      break
    }
    order.push(picked)
    resolved.add(picked)
    remaining.splice(remaining.indexOf(picked), 1)
  }

  return order.map(index => points[index])
}
