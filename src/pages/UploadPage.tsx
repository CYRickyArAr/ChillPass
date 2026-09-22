import { useState, useCallback, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { nanoid } from 'nanoid'
import { Download, FileText, Loader, X, ChevronRight, ChevronDown, CheckCircle, Settings } from 'lucide-react'
import { useCourseStore, useCurrentBundle } from '@stores/courseStore'
import { parseFile, cleanText } from '@services/fileParser'
import { storeFile } from '@services/browserFileStore'
import { extractExamPointsFromSources } from '@services/deepseek'
import { generateAllLessonsInBackground } from '@services/lessonGenerator'
import { LatestOperationProgress } from '../components/common/OperationProgress'
import LessonPlanCard from '../components/common/LessonPlanCard'
import type { ProgressReporter } from '@stores/operationProgressStore'
import type { CourseFile, CourseStatus } from '@types/index'
import { useT } from '../i18n'
import type { TranslationKey } from '../i18n'
import styles from './UploadPage.module.css'

type Phase = 'idle' | 'parsing' | 'extracting' | 'done'
type ImportMode = 'create' | 'append'

/** 课程状态标签（i18n key） */
const STATUS_LABEL_KEYS: Record<CourseStatus, TranslationKey> = {
  empty: 'upload.stEmpty',
  uploaded: 'upload.stUploaded',
  analyzing: 'upload.stAnalyzing',
  ready: 'upload.stReady',
}

/** 格式化文件大小 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 规范化扩展名，确保带前导点且小写 */
function normalizeExt(ext: string): string {
  if (!ext) return ''
  const e = ext.toLowerCase()
  return e.startsWith('.') ? e : '.' + e
}

/** 清洗每个文件并保留文件边界，供关卡生成时按来源检索上下文。 */
function buildTextSources(files: CourseFile[], texts: string[]) {
  return files.flatMap((file, index) => {
    const text = cleanText(texts[index] ?? '')
    return text ? [{ sourceFile: file.name, text }] : []
  })
}

function joinTextSources(sources: Array<{ sourceFile: string; text: string }>): string {
  return sources
    .map(source => `===== 来源文件：${source.sourceFile} =====\n${source.text}`)
    .join('\n\n')
}

function preparationReporter(courseId: string): ProgressReporter {
  let current = 0
  let total = 0
  return patch => {
    if (patch.current === undefined && patch.total === undefined) return
    current = patch.current ?? current
    total = patch.total ?? total
    useCourseStore.getState().setPreparationProgress(courseId, { stage: 'extracting', current, total })
  }
}

export default function UploadPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const entry = location.state as { appendCourseId?: string; importMode?: ImportMode } | null
  const appendCourseId = entry?.appendCourseId
  const requestedMode = entry?.importMode
  const t = useT()
  const bundle = useCurrentBundle()
  const currentCourse = bundle?.course
  const courses = useCourseStore(s => s.courses)
  const createCourse = useCourseStore(s => s.createCourse)
  const addFiles = useCourseStore(s => s.addFiles)
  const setRawText = useCourseStore(s => s.setRawText)
  const prepareLessonPlan = useCourseStore(s => s.prepareLessonPlan)
  const appendRawText = useCourseStore(s => s.appendRawText)
  const mergeExamPoints = useCourseStore(s => s.mergeExamPoints)
  const switchCourse = useCourseStore(s => s.switchCourse)
  const setCourseStatus = useCourseStore(s => s.setCourseStatus)
  const setPreparationProgress = useCourseStore(s => s.setPreparationProgress)

  const recoverableBundle =
    !requestedMode && !appendCourseId && bundle && bundle.course.status !== 'ready' && bundle.course.files.length > 0
      ? bundle
      : null
  const [mode, setMode] = useState<ImportMode>(
    requestedMode === 'create' ? 'create' : recoverableBundle ? 'create' : courses.length > 0 ? 'append' : 'create',
  )
  const [selectedCourseId, setSelectedCourseId] = useState<string>(
    currentCourse?.id ?? courses[0]?.course.id ?? ''
  )
  const [courseName, setCourseName] = useState(recoverableBundle?.course.name ?? '')
  // 增量模式下只显示新选择的文件，不显示已有文件
  const [files, setFiles] = useState<CourseFile[]>(recoverableBundle?.course.files ?? [])
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [error, setError] = useState<string | null>(
    recoverableBundle?.preparationProgress.stage === 'error'
      ? recoverableBundle.preparationProgress.error ?? null
      : null,
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [skippedFiles, setSkippedFiles] = useState<string[]>([])

  const isBusy = phase !== 'idle'
  const hasExistingCourses = courses.length > 0

  useEffect(() => {
    if (isBusy || (!requestedMode && !appendCourseId)) return
    const state = useCourseStore.getState()
    const targetId = appendCourseId ?? state.currentCourseId ?? state.courses[0]?.course.id ?? ''
    const nextMode = requestedMode === 'create' || state.courses.length === 0 ? 'create' : 'append'
    setMode(nextMode)
    if (state.courses.some(item => item.course.id === targetId)) setSelectedCourseId(targetId)
    if (nextMode === 'create') setCourseName('')
    setFiles([])
    setSkippedFiles([])
    setError(null)
    setNotice(null)
    // Only explicit navigation changes mode; edits and generation updates must not reset the form.
  }, [appendCourseId, requestedMode, location.key])

  useEffect(() => {
    if (isBusy || mode !== 'append' || !currentCourse?.id) return
    if (!courses.some(bundle => bundle.course.id === currentCourse.id)) return
    if (selectedCourseId === currentCourse.id) return

    setSelectedCourseId(currentCourse.id)
    setError(null)
    setNotice(null)
    if (files.length > 0) {
      setFiles([])
      setSkippedFiles([])
    }
  }, [courses, currentCourse?.id, files.length, isBusy, mode, selectedCourseId])

  const resolveTargetCourseName = useCallback(() => {
    if (mode === 'create') return courseName.trim()
    return courses.find(b => b.course.id === selectedCourseId)?.course.name.trim() ?? ''
  }, [courseName, courses, mode, selectedCourseId])

  /** 计算模式按钮样式 */
  const getModeButtonStyle = (isActive: boolean, disabled: boolean): React.CSSProperties => ({
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: 'inherit',
    color: isActive ? 'var(--btn-primary-fg)' : 'var(--text-secondary)',
    background: isActive ? 'var(--btn-primary-bg)' : 'transparent',
    border: 'none',
    borderRadius: 'var(--radius-pill)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    boxShadow: isActive ? 'var(--shadow-ambient)' : 'none',
    transition: 'all 0.25s ease',
  })

  /** 切换导入模式 */
  const handleModeChange = (newMode: ImportMode) => {
    if (isBusy) return
    if (newMode === 'append' && !hasExistingCourses) return
    setMode(newMode)
    setError(null)
    // 切换模式时清空已选文件
    setFiles([])
    setSkippedFiles([])
    if (newMode === 'create') {
      // 新课程必须从空名称开始，不能沿用当前或上一次输入的课程名。
      setCourseName('')
    } else {
      // 默认选中第一个课程（若尚未选择）
      if (!selectedCourseId && hasExistingCourses) {
        const firstId = courses[0].course.id
        setSelectedCourseId(firstId)
        switchCourse(firstId)
      } else if (selectedCourseId) {
        switchCourse(selectedCourseId)
      }
    }
  }

  /** 选择已有课程 */
  const handleSelectCourse = (id: string) => {
    if (isBusy) return
    setSelectedCourseId(id)
    switchCourse(id)
    setError(null)
  }

  /** 点击选择文件 */
  const handleSelectFiles = useCallback(async () => {
    if (isBusy) return
    try {
      const targetCourseName = resolveTargetCourseName()
      const result = await window.electronAPI?.openFileDialog({ courseName: targetCourseName || undefined })
      if (!result || result.length === 0) return
      const courseFiles: CourseFile[] = result.map(f => ({
        id: nanoid(),
        name: f.name,
        path: f.path,
        ext: normalizeExt(f.ext),
        size: f.size,
        uploadedAt: Date.now(),
      }))
      setFiles(prev => {
        const retained = prev.filter(old => !(old.path.startsWith('missing:') && courseFiles.some(f => f.name === old.name && f.size === old.size)))
        const existing = new Set(retained.map(p => `${p.name}\0${p.size}`))
        return [...retained, ...courseFiles.filter(file => {
          const key = `${file.name}\0${file.size}`
          if (existing.has(key)) return false
          existing.add(key)
          return true
        })]
      })
      setError(null)
      setNotice(null)
    } catch {
      setError(t('upload.errPickFile'))
    }
  }, [isBusy, mode, resolveTargetCourseName, t])

  /** 拖拽放置 */
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (isBusy) return
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length === 0) return

    try {
      const targetCourseName = resolveTargetCourseName()
      const courseFiles: CourseFile[] = []
      for (const file of dropped) {
        const nativePath = (file as File & { path?: string }).path?.trim()
        if (nativePath) {
          courseFiles.push({
            id: nanoid(),
            name: file.name,
            path: nativePath,
            ext: normalizeExt('.' + (file.name.split('.').pop() || '')),
            size: file.size,
            uploadedAt: Date.now(),
          })
          continue
        }

        // 普通浏览器不会暴露本机文件路径，需要先保存内容，再把存储 ID 当作 path。
        const meta = await storeFile(`file_${nanoid()}`, file, { courseName: targetCourseName || undefined })
        courseFiles.push({
          id: nanoid(),
          name: meta.name,
          path: meta.path,
          ext: normalizeExt(meta.ext),
          size: meta.size,
          uploadedAt: Date.now(),
        })
      }

      setFiles(prev => {
        const retained = prev.filter(old => !(old.path.startsWith('missing:') && courseFiles.some(f => f.name === old.name && f.size === old.size)))
        const existing = new Set(retained.map(p => `${p.name}\0${p.size}`))
        return [
          ...retained,
          ...courseFiles.filter(file => {
            const key = `${file.name}\0${file.size}`
            if (existing.has(key)) return false
            existing.add(key)
            return true
          }),
        ]
      })
      setError(null)
      setNotice(null)
    } catch {
      setError(t('upload.errPickFile'))
    }
  }, [isBusy, mode, resolveTargetCourseName, t])

  const handleScanCourseFolder = useCallback(async () => {
    if (isBusy) return
    const targetBundle = courses.find(b => b.course.id === selectedCourseId)
    if (!targetBundle) {
      setError(t('upload.errSelectCourse'))
      return
    }
    try {
      await window.electronAPI?.ensureCourseDirectory?.(targetBundle.course.name)
      const found = await window.electronAPI?.listCourseFiles?.(targetBundle.course.name) ?? []
      const knownPaths = new Set([
        ...targetBundle.course.files.map(file => file.path),
        ...files.map(file => file.path),
      ])
      const knownNameSizes = new Set([
        ...targetBundle.course.files.map(file => `${file.name}\0${file.size}`),
        ...files.map(file => `${file.name}\0${file.size}`),
      ])
      const newFiles = found.filter(file => {
        const nameSize = `${file.name}\0${file.size}`
        return !knownPaths.has(file.path) && !knownNameSizes.has(nameSize)
      })
      if (newFiles.length === 0) {
        setError(t('upload.noNewFolderFiles'))
        return
      }
      setFiles(prev => [
        ...prev,
        ...newFiles.map(file => ({
          id: nanoid(),
          name: file.name,
          path: file.path,
          ext: normalizeExt(file.ext),
          size: file.size,
          uploadedAt: Date.now(),
        })),
      ])
      setError(null)
      setNotice(null)
    } catch {
      setError(t('upload.errPickFile'))
    }
  }, [courses, files, isBusy, selectedCourseId, t])

  const handleOpenCourseFolder = useCallback(async () => {
    if (isBusy) return
    const targetBundle = courses.find(b => b.course.id === selectedCourseId)
    if (!targetBundle) {
      setError(t('upload.errSelectCourse'))
      return
    }
    try {
      await window.electronAPI?.ensureCourseDirectory?.(targetBundle.course.name)
      await window.electronAPI?.openCourseDirectory?.(targetBundle.course.name)
      setError(null)
    } catch {
      setError(t('upload.errPickFile'))
    }
  }, [courses, isBusy, selectedCourseId, t])

  /** 删除文件 */
  const handleRemoveFile = (id: string) => {
    if (isBusy) return
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  /** 新建课程模式：解析流程 */
  const handleCreateParse = async () => {
    if (!courseName.trim()) {
      setError(t('upload.errNameRequired'))
      return
    }
    if (files.length === 0) {
      const normalizedCourseName = courseName.trim()
      const existing = useCourseStore.getState().courses.find(
        item => item.course.name === normalizedCourseName,
      )
      if (existing?.course.status === 'ready') {
        setError(t('upload.errDuplicateName'))
        return
      }
      const newCourseId = existing?.course.id ?? createCourse(normalizedCourseName)
      if (!newCourseId) {
        setError(t('upload.errDuplicateName'))
        return
      }
      switchCourse(newCourseId)
      const dir = await window.electronAPI?.ensureCourseDirectory?.(normalizedCourseName)
      setSelectedCourseId(newCourseId)
      setMode('append')
      setNotice(t('upload.courseFolderReady').replace('{path}', dir?.path ?? normalizedCourseName))
      setError(null)
      return
    }

    setError(null)
    setPhase('parsing')
    setProgress(0)
    setProgressText(t('upload.parsing'))

    let activeCourseId: string | null = null
    try {
      const normalizedCourseName = courseName.trim()
      // 刷新后允许复用同名的未完成课程；已完成课程仍禁止重名。
      const incompleteCourse = useCourseStore.getState().courses.find(
        item => item.course.name === normalizedCourseName && item.course.status !== 'ready',
      )
      const newCourseId = incompleteCourse?.course.id ?? createCourse(normalizedCourseName)
      if (!newCourseId) {
        setError(t('upload.errDuplicateName'))
        setPhase('idle')
        setProgress(0)
        return
      }
      activeCourseId = newCourseId
      await window.electronAPI?.ensureCourseDirectory?.(normalizedCourseName)
      if (incompleteCourse) {
        switchCourse(newCourseId)
        const existingPaths = new Set(incompleteCourse.course.files.map(file => file.path))
        const additionalFiles = files.filter(file => !existingPaths.has(file.path))
        if (additionalFiles.length > 0) addFiles(additionalFiles)
      } else {
        addFiles(files)
      }
      setPreparationProgress(newCourseId, { stage: 'parsing', current: 0, total: files.length })

      // 逐个解析文件
      const texts: string[] = []
      for (let i = 0; i < files.length; i++) {
        setProgressText(t('upload.parsingFile').replace('{name}', files[i].name).replace('{i}', String(i + 1)).replace('{n}', String(files.length)))
        const text = await parseFile(files[i].path, files[i].ext)
        texts.push(text)
        setProgress(Math.round(((i + 1) / files.length) * 100))
        setPreparationProgress(newCourseId, { stage: 'parsing', current: i + 1, total: files.length })
      }

      // 分文件清洗并保留来源边界，后续每关可命中对应课件段落。
      const textSources = buildTextSources(files, texts)
      const cleaned = joinTextSources(textSources)
      setRawText(cleaned, newCourseId)

      // 提炼考点
      setCourseStatus(newCourseId, 'analyzing')
      setPreparationProgress(newCourseId, { stage: 'extracting', current: 0, total: 0 })
      setPhase('extracting')
      setProgressText(t('upload.extracting'))
      const points = await extractExamPointsFromSources(textSources, courseName.trim(), undefined, preparationReporter(newCourseId))
      // 先保存所有原始考点，等待用户确认关数；不提前消耗关卡生成请求。
      prepareLessonPlan(points, newCourseId)
      switchCourse(newCourseId)
      setPhase('idle')
      navigate('/')
    } catch (err) {
      if (activeCourseId) setCourseStatus(activeCourseId, 'uploaded')
      const message = err instanceof Error ? err.message : t('upload.parseFailed')
      if (activeCourseId) {
        setPreparationProgress(activeCourseId, { stage: 'error', current: 0, total: 0, error: message })
      }
      setError(message)
      setPhase('idle')
      setProgress(0)
    }
  }

  /** 增量导入模式：解析流程 */
  const handleAppendParse = async () => {
    if (!selectedCourseId) {
      setError(t('upload.errSelectCourse'))
      return
    }
    if (files.length === 0) {
      setError(t('upload.errFilesRequired'))
      return
    }

    const targetBundle = useCourseStore
      .getState()
      .courses.find(b => b.course.id === selectedCourseId)
    if (!targetBundle) {
      setError(t('upload.errCourseMissing'))
      return
    }
    if (
      targetBundle.optimizationJob?.status === 'running' ||
      targetBundle.optimizationJob?.status === 'paused'
    ) {
      setError(t('upload.errOptimizationBusy'))
      return
    }
    const courseNameForExtract = targetBundle.course.name
    // Reattach legacy imports even when duplicate-text detection skips re-extraction.
    const reattached: Record<string, string> = {}
    for (const old of targetBundle.course.files) {
      const replacement = files.find(file => file.name === old.name && file.size === old.size)
      if (old.path.startsWith('missing:') && replacement) reattached[old.path] = replacement.path
    }
    if (Object.keys(reattached).length) useCourseStore.getState().updateFilePaths(reattached)
    const previousStatus = targetBundle.course.status

    setError(null)
    setPhase('parsing')
    setProgress(0)
    setProgressText(t('upload.parsingAppend'))

    try {
      // 确保切换到目标课程
      switchCourse(selectedCourseId)
      setCourseStatus(selectedCourseId, 'analyzing')
      setPreparationProgress(selectedCourseId, { stage: 'parsing', current: 0, total: files.length })

      // 1. 逐个解析新文件，检测重复内容
      const texts: string[] = []
      const skipped: string[] = []
      const existingRawText = targetBundle.rawText || ''
      // 提取已有文本的特征句子（用于重复检测）
      const existingSentences = new Set(
        existingRawText.split(/[。\n！？!?]/).map(s => s.trim()).filter(s => s.length > 15)
      )

      for (let i = 0; i < files.length; i++) {
        setProgressText(t('upload.parsingFile').replace('{name}', files[i].name).replace('{i}', String(i + 1)).replace('{n}', String(files.length)))
        const text = await parseFile(files[i].path, files[i].ext)

        // 重复内容检测：计算与已有内容的句子重叠率
        if (existingSentences.size > 0) {
          const newSentences = text.split(/[。\n！？!?]/).map(s => s.trim()).filter(s => s.length > 15)
          if (newSentences.length > 0) {
            const overlapCount = newSentences.filter(s => existingSentences.has(s)).length
            const overlapRate = overlapCount / newSentences.length
            if (overlapRate > 0.7) {
              skipped.push(files[i].name)
              setProgress(Math.round(((i + 1) / files.length) * 100))
              setPreparationProgress(selectedCourseId, { stage: 'parsing', current: i + 1, total: files.length })
              continue // 跳过此文件
            }
          }
        }

        texts.push(text)
        setProgress(Math.round(((i + 1) / files.length) * 100))
        setPreparationProgress(selectedCourseId, { stage: 'parsing', current: i + 1, total: files.length })
      }

      setSkippedFiles(skipped)

      // 如果所有文件都被跳过
      if (texts.length === 0) {
        setCourseStatus(selectedCourseId, previousStatus === 'ready' ? 'ready' : 'uploaded')
        setPreparationProgress(selectedCourseId, { stage: 'idle', current: 0, total: 0 })
        setError(t('upload.allSkipped'))
        setPhase('idle')
        setProgress(0)
        return
      }

      // 记录新增文件到课程（只记录未跳过的）
      const validFiles = files.filter(f => !skipped.includes(f.name))
      addFiles(validFiles)

      // 2. 分文件清洗并追加，保留每个新增考点的真实来源。
      const textSources = buildTextSources(validFiles, texts)
      const cleaned = joinTextSources(textSources)
      appendRawText(cleaned)

      // 3. 只从新增课件文本中提炼考点（不重新提炼全部，避免已有关卡被重置）
      setCourseStatus(selectedCourseId, 'analyzing')
      setPreparationProgress(selectedCourseId, { stage: 'extracting', current: 0, total: 0 })
      setPhase('extracting')
      setProgressText(t('upload.extractingAppend'))
      const newPoints = await extractExamPointsFromSources(textSources, courseNameForExtract, undefined, preparationReporter(selectedCourseId))

      // 4. 增量合并（只为新考点创建关卡，已有内容的关卡完整保留）
      setProgressText(t('upload.merging'))
      setPreparationProgress(selectedCourseId, { stage: 'building', current: 0, total: newPoints.length })
      mergeExamPoints(newPoints)
      setPreparationProgress(selectedCourseId, { stage: 'idle', current: 0, total: 0 })

      // 5. 后台生成关卡内容（已有内容的关卡会自动跳过）
      generateAllLessonsInBackground(selectedCourseId)

      // 6. 显示完成状态后跳转到首页
      setPhase('done')
      setProgressText(t('upload.appendDone'))
      setProgress(100)
      setTimeout(() => navigate('/'), 1200)
    } catch (err) {
      setCourseStatus(selectedCourseId, previousStatus === 'ready' ? 'ready' : 'uploaded')
      const message = err instanceof Error ? err.message : t('upload.parseFailed')
      setPreparationProgress(selectedCourseId, { stage: 'error', current: 0, total: 0, error: message })
      setError(message)
      setPhase('idle')
      setProgress(0)
    }
  }

  /** 开始解析（按模式分发） */
  const handleStartParse = () => {
    if (mode === 'create') {
      void handleCreateParse()
    } else {
      void handleAppendParse()
    }
  }

  const startButtonText = isBusy
    ? t('upload.processing')
    : mode === 'create'
      ? t('upload.start')
      : t('upload.startAppend')

  // 当前选中的课程信息（增量模式用）
  const selectedBundle = mode === 'append' && selectedCourseId
    ? courses.find(b => b.course.id === selectedCourseId)
    : null

  if (bundle?.lessonPlanDraft && mode === 'create' &&
    (requestedMode !== 'create' || bundle.course.name === courseName.trim())) {
    return <div className={styles.page}><LessonPlanCard bundle={bundle} /></div>
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t(mode === 'create' ? 'upload.modeCreate' : 'upload.title')}</h1>
        <p className={styles.subtitle}>
          {t('upload.pageSubtitle')}
        </p>
      </header>

      <div className={`${styles.card} liquid-glass`}>
        {/* 模式选择器 */}
        <div style={modeSelectorStyle}>
          <button
            type="button"
            style={getModeButtonStyle(mode === 'create', isBusy)}
            onClick={() => handleModeChange('create')}
            disabled={isBusy}
          >
            <FileText size={16} strokeWidth={2} />
            <span>{t('upload.modeCreate')}</span>
          </button>
          <button
            type="button"
            style={getModeButtonStyle(mode === 'append', isBusy || !hasExistingCourses)}
            onClick={() => handleModeChange('append')}
            disabled={isBusy || !hasExistingCourses}
            title={!hasExistingCourses ? t('upload.noExisting') : t('upload.appendTip')}
          >
            <CheckCircle size={16} strokeWidth={2} />
            <span>{t('upload.modeAppendFull')}</span>
          </button>
        </div>
        {!hasExistingCourses && (
          <div style={hintStyle}>{t('upload.appendModeHint')}</div>
        )}

        {/* 新建课程模式：课程名称 */}
        {mode === 'create' && (
          <div className={styles.field}>
            <label className={styles.label}>{t('upload.courseName')}</label>
            <input
              className={styles.input}
              type="text"
              placeholder={t('upload.courseNameExample')}
              value={courseName}
              onChange={e => setCourseName(e.target.value)}
              disabled={isBusy}
            />
          </div>
        )}

        {/* 增量导入模式：课程选择 */}
        {mode === 'append' && (
          <div className={styles.field}>
            <label className={styles.label}>{t('upload.selectExisting')}</label>
            <div style={selectWrapperStyle}>
              <select
                style={{
                  ...selectStyle,
                  opacity: isBusy ? 0.5 : 1,
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                }}
                value={selectedCourseId}
                onChange={e => handleSelectCourse(e.target.value)}
                disabled={isBusy}
              >
                {courses.map(b => (
                  <option key={b.course.id} value={b.course.id}>
                    {b.course.name}（{t(STATUS_LABEL_KEYS[b.course.status])}）
                  </option>
                ))}
              </select>
              <ChevronDown size={16} strokeWidth={2} style={selectIconStyle} />
            </div>
            {selectedBundle && (
              <div style={courseInfoStyle}>
                {t('upload.selectedInfo')
                  .replace('{name}', selectedBundle.course.name)
                  .replace('{points}', String(selectedBundle.examPoints.length))
                  .replace('{lessons}', String(selectedBundle.lessons.length))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleOpenCourseFolder}
                disabled={isBusy || !selectedCourseId}
              >
                {t('upload.openCourseFolder')}
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleScanCourseFolder}
                disabled={isBusy || !selectedCourseId}
              >
                {t('upload.scanCourseFolder')}
              </button>
            </div>
          </div>
        )}

        {/* 拖拽上传区 */}
        <div
          className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ''}`}
          onClick={handleSelectFiles}
          onDragOver={e => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
        >
          <div className={styles.dropzoneIcon}>
            <Download size={32} strokeWidth={1.6} />
          </div>
          <div className={styles.dropzoneText}>
            {mode === 'append' ? t('upload.dropAppend') : t('upload.dropCreate')}
          </div>
          <div className={styles.dropzoneHint}>{t('upload.dropzoneHint')}</div>
        </div>

        {/* 文件列表 */}
        {files.length > 0 && (
          <div className={styles.fileList}>
            {files.map(file => (
              <div key={file.id} className={styles.fileItem}>
                <div className={styles.fileIcon}>
                  <FileText size={18} strokeWidth={1.8} />
                </div>
                <div className={styles.fileInfo}>
                  <span className={styles.fileName}>{file.name}</span>
                  <span className={styles.fileSize}>{formatFileSize(file.size)}</span>
                </div>
                <button
                  className={styles.fileRemove}
                  onClick={() => handleRemoveFile(file.id)}
                  disabled={isBusy}
                  aria-label={t('upload.removeFile')}
                >
                  <X size={16} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 错误信息 */}
        {error && (
          <div className={styles.error}>
            <X size={16} strokeWidth={2} />
            <span>{error}</span>
            {error.includes('API Key') && (
              <button
                onClick={() => navigate('/settings/api')}
                style={{
                  marginLeft: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 12px',
                  background: 'var(--accent-text)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                  transition: 'opacity 0.2s ease',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                <Settings size={14} strokeWidth={2} />
                {t('upload.goConfig')}
              </button>
            )}
          </div>
        )}

        {notice && !error && (
          <div className={styles.progress}>
            <div className={styles.progressHeader}>
              <CheckCircle size={18} strokeWidth={2} />
              <span>{notice}</span>
            </div>
          </div>
        )}

        {/* 跳过文件提示 */}
        {skippedFiles.length > 0 && !isBusy && (
          <div className={styles.progress}>
            <div className={styles.progressHeader} style={{ color: 'var(--warning-text)' }}>
              <span>{t('upload.skipped').replace('{count}', String(skippedFiles.length)).replace('{names}', skippedFiles.join('、'))}</span>
            </div>
          </div>
        )}

        {/* 解析进度 — 增强版步骤指示器 */}
        {isBusy && (
          <div className={styles.progress}>
            {/* 步骤指示器 */}
            <div className={styles.stepIndicator}>
              {([
                { key: 'parsing', label: t('upload.stepParse'), icon: '📄' },
                { key: 'extracting', label: t('upload.stepExtract'), icon: '🧠' },
                { key: 'done', label: t('upload.stepPath'), icon: '✨' },
              ] as { key: Phase; label: string; icon: string }[]).map((step, i) => {
                const stepOrder: Record<string, number> = { parsing: 1, extracting: 2, done: 3 }
                const currentOrder = stepOrder[phase] ?? 0
                const stepOrderVal = stepOrder[step.key] ?? 0
                const isStepDone = stepOrderVal < currentOrder
                const isStepActive = stepOrderVal === currentOrder

                return (
                  <div key={step.key} className={styles.stepItem}>
                    <div
                      className={`${styles.stepCircle} ${
                        isStepDone ? styles.stepCircleDone : ''
                      } ${isStepActive ? styles.stepCircleActive : ''}`}
                    >
                      {isStepDone ? '✓' : step.icon}
                    </div>
                    <span
                      className={`${styles.stepLabel} ${
                        isStepActive ? styles.stepLabelActive : ''
                      } ${isStepDone ? styles.stepLabelDone : ''}`}
                    >
                      {step.label}
                    </span>
                    {i < 2 && (
                      <div
                        className={`${styles.stepConnector} ${
                          isStepDone ? styles.stepConnectorDone : ''
                        }`}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            {phase === 'extracting' ? (
              <LatestOperationProgress kind="extract" detail={mode === 'create' ? courseName.trim() : selectedBundle?.course.name} />
            ) : <>
            {/* 当前状态文本 */}
            <div className={styles.progressHeader}>
              <Loader size={18} className={styles.spinnerIcon} />
              <span>{progressText}</span>
              <span>{progress}%</span>
            </div>

            {/* 进度条 */}
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{
                  width: `${progress}%`,
                }}
              />
            </div>
            </>}
          </div>
        )}

        {/* 开始按钮 */}
        <button
          className={styles.parseButton}
          onClick={handleStartParse}
          disabled={isBusy}
        >
          {startButtonText}
          {!isBusy && <ChevronRight size={18} strokeWidth={2} />}
        </button>
      </div>
    </div>
  )
}

/* ===== 内联样式（新增元素，不修改 CSS Module） ===== */

const modeSelectorStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: 4,
  background: 'var(--surface-muted)',
  borderRadius: 'var(--radius-pill)',
}

const hintStyle: React.CSSProperties = {
  fontSize: 14,
  color: 'var(--text-tertiary)',
  padding: '0 4px',
  marginTop: -8,
}

const selectWrapperStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 40px 12px 16px',
  fontSize: 16,
  fontFamily: 'inherit',
  color: 'var(--text-primary)',
  background: 'var(--control-bg)',
  border: '1px solid var(--control-border)',
  borderRadius: 'var(--radius-md)',
  outline: 'none',
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  transition: 'all 0.3s ease',
}

const selectIconStyle: React.CSSProperties = {
  position: 'absolute',
  right: 14,
  top: '50%',
  transform: 'translateY(-50%)',
  color: 'var(--text-secondary)',
  pointerEvents: 'none',
}

const courseInfoStyle: React.CSSProperties = {
  fontSize: 14,
  color: 'var(--text-tertiary)',
  padding: '0 4px',
}
