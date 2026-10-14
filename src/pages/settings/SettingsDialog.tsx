import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cpu, HardDrive, Info, SlidersHorizontal, X } from 'lucide-react'
import SettingsPage from '../SettingsPage'
import ApiSettings from './ApiSettings'
import StorageSettings from './StorageSettings'
import AboutSettings from './AboutSettings'
import styles from './SettingsDialog.module.css'

const tabs = [
  { path: '/settings', label: '常规', icon: SlidersHorizontal },
  { path: '/settings/api', label: '模型', icon: Cpu },
  { path: '/settings/storage', label: '存储', icon: HardDrive },
  { path: '/settings/about', label: '关于', icon: Info },
]

export default function SettingsDialog({ pathname, returnTo }: { pathname: string; returnTo: string }) {
  const navigate = useNavigate()
  const dialog = useRef<HTMLDialogElement>(null)
  const [dirty, setDirty] = useState(false)
  const tab = pathname === '/settings/data' ? '/settings/storage' : tabs.some(t => t.path === pathname) ? pathname : '/settings'
  const canLeave = useCallback(() => !dirty || window.confirm('模型配置尚未保存。确定放弃这些修改吗？'), [dirty])
  const close = useCallback(() => { if (canLeave()) navigate(returnTo, { replace: true }) }, [canLeave, navigate, returnTo])

  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement as HTMLElement | null
    element.showModal()
    return () => { element.close(); previousFocus?.focus() }
  }, [])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="settings-heading"
    onCancel={event => { event.preventDefault(); close() }}>
    <header className={styles.header}>
      <h1 id="settings-heading">设置</h1>
      <div className={styles.tabs} role="tablist" aria-label="设置分类">
        {tabs.map(({ path, label, icon: Icon }, index) => <button key={path} type="button" role="tab"
          id={`settings-tab-${index}`} aria-selected={tab === path} aria-controls="settings-panel" tabIndex={tab === path ? 0 : -1}
          className={`${styles.tab} ${tab === path ? styles.selectedTab : ''}`}
          onClick={() => { if (tab !== path && canLeave()) { setDirty(false); navigate(path, { replace: true }) } }}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
            if (canLeave()) { setDirty(false); navigate(tabs[next].path, { replace: true }); document.getElementById(`settings-tab-${next}`)?.focus() }
          }}><Icon size={20} strokeWidth={1.7} />{label}</button>)}
      </div>
      <button type="button" className={styles.iconButton} onClick={close} aria-label="关闭设置" title="关闭设置 (Esc)"><X size={21} /></button>
    </header>
    <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tabs.findIndex(item => item.path === tab)}`}
      className={tab === '/settings/api' ? styles.modelPanel : styles.scrollPanel}>
      {tab === '/settings' && <SettingsPage onClose={close} />}
      {tab === '/settings/api' && <ApiSettings onDirtyChange={setDirty} />}
      {tab === '/settings/storage' && <StorageSettings embedded />}
      {tab === '/settings/about' && <AboutSettings embedded />}
    </div>
  </dialog>
}
