import type { CourseBundle } from '../types'
import { readFileBuffer, storeFile, validateFileBuffer } from './browserFileStore'

interface EmbeddedFile { id: string; base64: string; sha256: string }
type Archive = CourseBundle & { archiveVersion?: number; embeddedFiles?: EmbeddedFile[] }
const digest = async (buffer: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), b => b.toString(16).padStart(2, '0')).join('')

export async function buildCourseArchive(bundle: CourseBundle): Promise<Archive> {
  const embeddedFiles: EmbeddedFile[] = []
  for (const file of bundle.course.files) {
    const buffer = await readFileBuffer(file.path)
    validateFileBuffer(file.name, buffer, file.size)
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
    embeddedFiles.push({ id: file.id, base64: btoa(binary), sha256: await digest(buffer) })
  }
  const { optimizationJob: _job, ...content } = bundle
  return { ...content, archiveVersion: 1, embeddedFiles, generatingLessons: false, generationPaused: false }
}

/** Verify the entire archive before writing anything. Never trust another computer's paths. */
export async function restoreCourseFiles(data: Archive): Promise<CourseBundle> {
  const decoded = new Map<string, ArrayBuffer>()
  const files = Array.isArray(data.course.files) ? data.course.files : []
  if (data.archiveVersion !== undefined && data.archiveVersion !== 1) throw new Error('不支持的课程包版本')
  if (data.archiveVersion === 1) {
    if (!Array.isArray(data.embeddedFiles) || data.embeddedFiles.length !== files.length) throw new Error('课程包缺少课件文件')
    for (const file of files) {
      const entries = data.embeddedFiles.filter(f => f.id === file.id)
      if (entries.length !== 1) throw new Error(`课件记录无效：${file.name}`)
      const entry = entries[0]
      const binary = atob(entry.base64)
      const buffer = Uint8Array.from(binary, c => c.charCodeAt(0)).buffer
      validateFileBuffer(file.name, buffer, file.size)
      if (await digest(buffer) !== entry.sha256) throw new Error(`课件校验失败：${file.name}`)
      decoded.set(file.id, buffer)
    }
  }
  const restored = []
  for (const file of files) {
    const id = `file_${crypto.randomUUID()}`
    const buffer = decoded.get(file.id)
    if (!buffer) {
      restored.push({ ...file, path: `missing:${id}` })
      continue
    }
    const meta = await storeFile(id, new File([buffer], file.name), { courseName: data.course.name })
    restored.push({ ...file, ...meta })
  }
  const { embeddedFiles: _files, archiveVersion: _version, ...bundle } = data
  return { ...bundle, course: { ...bundle.course, files: restored } }
}
