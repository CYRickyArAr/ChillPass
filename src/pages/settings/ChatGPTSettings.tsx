import { useEffect, useState } from 'react'
import { chatGPTJson } from '@services/chatgpt'
import { connectCodexUsage, confirmCodexUsageConnection } from '@services/chatgptUsage'
import { refreshChatGPTStatus, useChatGPTStore } from '@stores/chatgptStore'
import ui from './SettingsDialog.module.css'
import styles from './ModelsSettings.module.css'

/** Connection controls only. Model selection and save now live in the shared provider editor. */
export default function ChatGPTSettings() {
  const auth = useChatGPTStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  useEffect(() => { void refreshChatGPTStatus().catch(error => setError(error.message)) }, [])
  useEffect(() => {
    if (!auth.pending) { setAuthUrl(''); return }
    const timer = window.setInterval(() => { void refreshChatGPTStatus().catch(error => setError(error.message)) }, 2000)
    return () => clearInterval(timer)
  }, [auth.pending])
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (error) { setError(error instanceof Error ? error.message : '操作失败，请重试。') }
    finally { setBusy(false) }
  }
  function login(accountId?: string, consent = false) {
    const popup = window.open('about:blank', '_blank')
    if (popup) { popup.opener = null; popup.document.title = 'ChatGPT 登录'; popup.document.body.textContent = '正在连接 OpenAI…' }
    void run(async () => {
      try {
        const result = await chatGPTJson<{ authorizationUrl: string }>('/login', { accountId, consent })
        const url = new URL(result.authorizationUrl)
        if (url.origin !== 'https://auth.openai.com') throw new Error('登录地址无效。')
        setAuthUrl(url.href)
        if (popup && !popup.closed) popup.location.replace(url.href)
        await refreshChatGPTStatus()
      } catch (error) { popup?.close(); throw error }
    })
  }
  return <section className={styles.connection} aria-label="ChatGPT 连接" aria-busy={busy}>
    <div className={styles.providerHeading}>
      <div><span className={styles.eyebrow}>订阅</span><h2>ChatGPT</h2></div>
      <div className={ui.actions}>
        <span className={auth.planEnabled ? styles.connected : styles.status} role="status"><i />{auth.planEnabled ? '已连接' : auth.connected ? '未授权套餐' : '未连接'}</span>
        <button type="button" className={ui.primary} disabled={busy || auth.pending} onClick={() => login(auth.activeId || undefined, auth.connected && !auth.planEnabled)}>
          {auth.connected ? auth.planEnabled ? '重新登录' : '启用套餐授权' : 'Continue with ChatGPT'}
        </button>
        {auth.connected && <button type="button" className={ui.danger} disabled={busy} onClick={() => {
          void run(async () => {
            const result = await chatGPTJson<{ warning?: string }>('/logout', {})
            await refreshChatGPTStatus(); setNotice(result.warning || '已断开连接，未切换到其他计费方式。')
          })
        }}>断开连接</button>}
      </div>
    </div>
    {auth.accounts.length > 0 && <div className={styles.accountRow}>
      <label htmlFor="chatgpt-account">账号</label>
      <select id="chatgpt-account" className={styles.input} value={auth.activeId || ''} disabled={busy || auth.pending} onChange={event => {
        const id = event.target.value
        if (!auth.accounts.find(item => item.id === id)?.connected) { login(id); return }
        void run(async () => { await chatGPTJson('/switch', { accountId: id }); await refreshChatGPTStatus() })
      }}>
        {!auth.activeId && <option value="">选择账号</option>}
        {auth.accounts.map(item => <option key={item.id} value={item.id}>{item.label} · {item.email || item.id}{item.connected ? '' : '（已退出）'}</option>)}
      </select>
      <button type="button" className={ui.button} disabled={busy || auth.pending} onClick={() => login()}>添加账号</button>
    </div>}
    <p className={styles.hint} title="凭据由本机后端保管，Windows 使用 DPAPI 加密；额度不足不会自动切换计费方式。">使用 ChatGPT 套餐额度，无需 API Key；凭据仅保存在本机。</p>
    {auth.connected && <div className={styles.accountRow}>
      <span className={styles.hint}>额度来源：{auth.usageConnected ? '本机 Codex（仅查询）' : '尚未连接 Codex'}</span>
      <button type="button" className={ui.button} disabled={busy || auth.pending} onClick={() => {
        if (!auth.usageConnected && !confirmCodexUsageConnection()) return
        void run(async () => {
          if (auth.usageConnected) await chatGPTJson('/usage/disconnect', { accountId: auth.activeId })
          else await connectCodexUsage(auth.activeId!)
          await refreshChatGPTStatus()
          setNotice(auth.usageConnected ? '已停止读取 Codex 额度，不会退出 Codex 或改变模型授权。' : '额度来源已连接，可在主界面左上角直接查询。')
        })
      }}>{auth.usageConnected ? '停止读取额度' : '连接 Codex 额度'}</button>
    </div>}
    {auth.pending && <div className={styles.notice} role="status">
      <span>等待浏览器授权… 完成后请返回此窗口。</span>
      <div className={ui.actions}>
        {authUrl && <a href={authUrl} target="_blank" rel="noreferrer noopener">重新打开授权页</a>}
        <button type="button" className={ui.button} disabled={busy} onClick={() => { void run(async () => { await chatGPTJson('/cancel', {}); await refreshChatGPTStatus() }) }}>取消等待</button>
      </div>
    </div>}
    {(error || auth.error) && <p className={styles.error} role="alert">{error || auth.error}</p>}
    {notice && <p className={styles.hint} role="status">{notice}</p>}
  </section>
}
