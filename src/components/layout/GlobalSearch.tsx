import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useCourseStore } from '@stores/courseStore'
import { makeQuizQuestionRefs, useQuizProgressStore } from '@stores/quizProgressStore'
import type { Lesson } from '@types/index'
import { useT } from '../../i18n'
import styles from './GlobalSearch.module.css'

interface SearchResult {
  courseId: string
  courseName: string
  lesson: Lesson
  matchedText: string
  score: number
}

interface SearchField {
  text: string
  normalized: string
  fuzzy: boolean
}

interface SearchItem {
  courseId: string
  courseName: string
  current: boolean
  lesson: Lesson
  fields: SearchField[]
}

function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]{}<>《》·—_-]/g, '')
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  const current = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j]
  }

  return previous[b.length]
}

/** 精确命中优先；模糊匹配只用于标题/公式等短字段，避免长文本卡住输入。 */
function matchScore(normalizedQuery: string, field: SearchField): number {
  const normalizedValue = field.normalized
  if (!normalizedQuery || !normalizedValue) return 0
  if (normalizedValue === normalizedQuery) return 120
  if (normalizedValue.startsWith(normalizedQuery)) return 110
  if (normalizedValue.includes(normalizedQuery)) return 100
  if (!field.fuzzy || normalizedQuery.length < 2) return 0

  const compare = (candidate: string) => {
    const longest = Math.max(normalizedQuery.length, candidate.length)
    return longest === 0
      ? 0
      : 1 - levenshteinDistance(normalizedQuery, candidate) / longest
  }

  let similarity = 0
  if (normalizedValue.length <= normalizedQuery.length + 4) {
    similarity = compare(normalizedValue)
  }
  if (normalizedValue.length > normalizedQuery.length && normalizedValue.length <= 180) {
    const minLength = Math.max(2, normalizedQuery.length - 1)
    const maxLength = Math.min(normalizedValue.length, normalizedQuery.length + 1)
    for (let length = minLength; length <= maxLength; length++) {
      for (let start = 0; start + length <= normalizedValue.length; start++) {
        similarity = Math.max(similarity, compare(normalizedValue.slice(start, start + length)))
      }
    }
  }

  return similarity >= 0.66 ? 60 + similarity * 30 : 0
}

function makeField(value: unknown, fuzzy = false): SearchField | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  return {
    text,
    normalized: normalizeText(text),
    // 长字段不跑编辑距离；标题、考点、公式等短字段才允许模糊匹配
    fuzzy: fuzzy && text.length <= 80,
  }
}

export default function GlobalSearch() {
  const t = useT()
  const navigate = useNavigate()
  const courses = useCourseStore(state => state.courses)
  const currentCourseId = useCourseStore(state => state.currentCourseId)
  const switchCourse = useCourseStore(state => state.switchCourse)
  const setActiveTab = useQuizProgressStore(state => state.setActiveTab)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const deferredQuery = useDeferredValue(query)

  const searchItems = useMemo<SearchItem[]>(() => {
    const items: SearchItem[] = []
    for (const bundle of courses) {
      const pointsById = new Map(bundle.examPoints.map(point => [point.id, point]))
      for (const lesson of bundle.lessons) {
        const point = pointsById.get(lesson.examPointId)
        const content = lesson.content
        const fields = [
          makeField(lesson.title, true),
          makeField(point?.title, true),
          makeField(point?.description, true),
          ...(Array.isArray(point?.keyFormulas)
            ? point.keyFormulas.map(value => makeField(value, true))
            : []),
          ...(Array.isArray(content?.keyPoints)
            ? content.keyPoints.map(value => makeField(value, false))
            : []),
          makeField(content?.explanation, false),
          ...(Array.isArray(content?.examples)
            ? content.examples.flatMap(example => [
                makeField(example.question, false),
                makeField(example.answer, false),
              ])
            : []),
          ...(Array.isArray(content?.quiz)
            ? content.quiz.map(item => makeField(item.question, false))
            : []),
        ].filter((value): value is SearchField => Boolean(value))

        items.push({
          courseId: bundle.course.id,
          courseName: bundle.course.name,
          current: bundle.course.id === currentCourseId,
          lesson,
          fields,
        })
      }
    }
    return items
  }, [courses, currentCourseId])

  const results = useMemo<SearchResult[]>(() => {
    const normalizedQuery = normalizeText(deferredQuery)
    if (!normalizedQuery) return []
    const matches: SearchResult[] = []

    for (const item of searchItems) {
      let bestScore = 0
      let matchedText = item.lesson.title
      for (const field of item.fields) {
        const score = matchScore(normalizedQuery, field)
        if (score > bestScore) {
          bestScore = score
          matchedText = field.text
        }
      }

      if (bestScore > 0) {
        matches.push({
          courseId: item.courseId,
          courseName: item.courseName,
          lesson: item.lesson,
          matchedText,
          score: bestScore + (item.current ? 3 : 0),
        })
      }
    }

    return matches
      .sort((a, b) => b.score - a.score || a.lesson.order - b.lesson.order)
      .slice(0, 8)
  }, [deferredQuery, searchItems])

  useEffect(() => {
    setActiveIndex(0)
  }, [deferredQuery])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  const openResult = (result: SearchResult) => {
    const questionRefs = makeQuizQuestionRefs(result.lesson.id, result.lesson.content?.quiz ?? [])
    switchCourse(result.courseId)
    setActiveTab(result.courseId, result.lesson.id, questionRefs, 'points')
    setQuery('')
    setOpen(false)
    navigate(`/lessons/${result.lesson.id}`)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex(index => (index + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex(index => (index - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      openResult(results[activeIndex] ?? results[0])
    }
  }

  const hasQuery = query.trim().length > 0

  return (
    <div className={styles.root} ref={rootRef}>
      <div
        className={`${styles.inputShell} ${open && hasQuery ? styles.inputShellOpen : ''}`}
        onPointerDown={event => {
          const target = event.target
          if (
            target !== inputRef.current
            && target instanceof HTMLElement
            && !target.closest('button')
          ) {
            event.preventDefault()
            inputRef.current?.focus()
          }
        }}
      >
        <Search size={14} strokeWidth={2} className={styles.searchIcon} />
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          aria-expanded={open && hasQuery}
          onFocus={() => setOpen(true)}
          onChange={event => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onKeyDown={handleKeyDown}
        />
        {hasQuery && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            aria-label={t('search.clear')}
          >
            <X size={13} strokeWidth={2} />
          </button>
        )}
      </div>

      {open && hasQuery && (
        <div className={styles.dropdown} role="listbox">
          {results.length === 0 ? (
            <div className={styles.empty}>{t('search.noResults')}</div>
          ) : (
            results.map((result, index) => (
              <button
                key={`${result.courseId}-${result.lesson.id}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`${styles.result} ${index === activeIndex ? styles.resultActive : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => openResult(result)}
              >
                <span className={styles.resultTitle}>{result.lesson.title}</span>
                <span className={styles.resultMeta}>
                  {t('search.resultMeta')
                    .replace('{course}', result.courseName)
                    .replace('{order}', String(result.lesson.order))}
                </span>
                {normalizeText(result.matchedText) !== normalizeText(result.lesson.title) && (
                  <span className={styles.resultMatch}>
                    {t('search.matchLabel').replace('{text}', result.matchedText)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
