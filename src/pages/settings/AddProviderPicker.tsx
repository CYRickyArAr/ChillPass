import { useEffect, useRef, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import ProviderIcon from '@components/common/ProviderIcon'
import { BUILTIN_PROVIDER_IDS, BUILTIN_PROVIDER_PRESETS } from '@stores/settingsStore'
import type { BuiltinAIProvider } from '@stores/settingsStore'
import ui from './SettingsDialog.module.css'
import styles from './AddProviderPicker.module.css'

interface Props {
  configured: BuiltinAIProvider[]
  onSelect: (id: BuiltinAIProvider) => void
  onAddCustom: () => void
  onClose: () => void
}

/** Nested modal: search/group/select like Pi Desktop, limited to integrations we actually support. */
export default function AddProviderPicker({ configured, onSelect, onAddCustom, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const available = BUILTIN_PROVIDER_IDS.filter(id => !configured.includes(id) && `${id} ${BUILTIN_PROVIDER_PRESETS[id].name} ${id === 'chatgpt' ? 'OpenAI ChatGPT OAuth 订阅 套餐' : id === 'opencode-go' ? '订阅 套餐 API Key' : 'API Key'}`.toLowerCase().includes(q))
  const custom = !q || ['自定义', 'custom', 'openai', '兼容', 'compatible', 'endpoint', '端点'].some(word => word.includes(q) || q.includes(word))
  const groups = [
    { title: '订阅服务', ids: available.filter(id => id === 'chatgpt' || id === 'opencode-go') },
    { title: 'API Key', ids: available.filter(id => id !== 'chatgpt' && id !== 'opencode-go') },
  ]
  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement as HTMLElement | null
    element.showModal()
    input.current?.focus()
    return () => { element.close(); if (previous?.isConnected) previous.focus() }
  }, [])

  return <dialog ref={dialog} className={styles.picker} aria-labelledby="add-provider-title"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <h2 id="add-provider-title" className={styles.srOnly}>添加服务商</h2>
    <div className={styles.search}>
      <Search size={17} />
      <input ref={input} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索服务商…" aria-label="搜索服务商" />
      <button type="button" className={ui.iconButton} onClick={onClose} aria-label="关闭服务商选择"><X size={18} /></button>
    </div>
    <div className={styles.body}>
      {custom && <section className={styles.group} aria-label="自定义服务商">
        <h3>自定义</h3>
        <div className={styles.grid}>
          <button type="button" className={styles.card} onClick={() => { onAddCustom(); onClose() }}>
            <span className={styles.copy}><strong>OpenAI compatible</strong><small>自定义端点格式</small></span>
            <span className={styles.customIcon}><Plus size={19} /></span>
          </button>
        </div>
      </section>}
      {groups.map(group => group.ids.length > 0 && <section className={styles.group} key={group.title} aria-label={group.title}>
        <h3>{group.title}</h3>
        <div className={styles.grid}>
          {group.ids.map(id => <button type="button" key={id} className={styles.card} onClick={() => { onSelect(id); onClose() }}>
            <span className={styles.copy}><strong>{id === 'chatgpt' ? 'OpenAI (ChatGPT 套餐)' : BUILTIN_PROVIDER_PRESETS[id].name}</strong><small>{id === 'chatgpt' ? 'OAuth' : id === 'opencode-go' ? '套餐 API Key' : 'API Key · OpenAI 兼容'}</small></span>
            <span className={styles.providerIcon}><ProviderIcon provider={id} name={BUILTIN_PROVIDER_PRESETS[id].name} size={28} /></span>
          </button>)}
        </div>
      </section>)}
      {!custom && !available.length && <p className={styles.empty}>没有匹配的服务商。已连接的服务商请从左侧列表选择。</p>}
    </div>
  </dialog>
}
