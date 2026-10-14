import { useState } from 'react'
import { LearningDataConflictError, recoverLearningData } from '../../services/learningDataStorage'
import styles from './LearningDataRecovery.module.css'

const names: Record<string, string> = {
  'chillpass-course-v2': '课程与学习进度',
  'chillpass-quiz-progress-v1': '小测进度',
  'chillpass-wrong-questions': '错题记录',
  'chillpass-chat': 'Athena 对话',
  'chillpass-chat-current': '当前会话选择',
  'athena-storage': 'Athena 记忆',
}

function describe(value: string | null) {
  if (value === null) return '无数据（选择此项会使用空记录）'
  if (!value) return '空内容'
  const size = new Blob([value]).size
  const volume = size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
  try {
    const state = JSON.parse(value)?.state
    if (Array.isArray(state?.courses)) return `${state.courses.length} 门课程 · ${volume}`
    if (Array.isArray(state?.conversations)) return `${state.conversations.length} 个会话 · ${volume}`
  } catch { /* Current-conversation IDs are plain strings. */ }
  return volume
}

export default function LearningDataRecovery({ conflict }: { conflict: LearningDataConflictError }) {
  const [choices, setChoices] = useState<Record<string, 'disk' | 'browser'>>(() =>
    Object.fromEntries(conflict.conflicts.map(item => [item.key, 'disk'])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function recover() {
    setBusy(true)
    setError('')
    try {
      await recoverLearningData(conflict, choices)
      window.location.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  return <main className={styles.page}>
    <section className={styles.panel} aria-labelledby="recovery-title" aria-busy={busy}>
      <h1 id="recovery-title">选择要继续使用的数据</h1>
      <p>浏览器还有未保存修改，但硬盘版本已经变化。两份数据都没有被丢弃，请先暂停其他 ChillPass 窗口的操作。</p>
      <p>默认使用硬盘版；如果本窗口有需要保留的最新修改，可改选浏览器版。不同版本不会自动合并，无冲突的数据保持原样。</p>
      <form onSubmit={event => { event.preventDefault(); void recover() }}>
        {conflict.conflicts.map(item => <fieldset key={item.key} className={styles.item} disabled={busy}>
          <legend>{names[item.key] || item.key}</legend>
          <div className={styles.options}>
            <label className={styles.option}>
              <input type="radio" name={item.key} value="disk" checked={choices[item.key] === 'disk'}
                onChange={() => setChoices(value => ({ ...value, [item.key]: 'disk' }))} />
              <span><strong>硬盘版本</strong><small>{describe(item.disk?.value ?? null)}</small>
                {item.disk?.savedAt && <small>保存于 {new Date(item.disk.savedAt).toLocaleString()}</small>}
              </span>
            </label>
            <label className={styles.option}>
              <input type="radio" name={item.key} value="browser" checked={choices[item.key] === 'browser'}
                onChange={() => setChoices(value => ({ ...value, [item.key]: 'browser' }))} />
              <span><strong>浏览器未保存版本</strong><small>{describe(item.browser.value)}</small><small>选择后保存到硬盘</small></span>
            </label>
          </div>
        </fieldset>)}
        <p className={styles.backup}>继续前会先备份两份数据及待保存队列；备份成功后才恢复。备份位置：<br />
          <code>{conflict.snapshot.root}\_chillpass-data\backups</code>
        </p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button className={styles.primary} type="submit" disabled={busy}>{busy ? '正在备份并恢复…' : '备份并恢复所选版本'}</button>
          <button type="button" disabled={busy} onClick={() => window.location.reload()}>重新检查</button>
        </div>
      </form>
    </section>
  </main>
}
