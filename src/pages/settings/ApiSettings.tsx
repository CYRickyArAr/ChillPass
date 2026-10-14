import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Eye, EyeOff, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import ProviderIcon from '@components/common/ProviderIcon'
import {
  BUILTIN_PROVIDER_IDS, DEFAULT_CUSTOM_USAGE_SCRIPT, getProviderConnection, getProviderDisplayName,
  isCustomProviderId, getVisibleProviderIds, PROVIDER_DEFAULT_MODEL, useSettingsStore,
} from '@stores/settingsStore'
import type { AIProvider, ProviderConnectionSettings } from '@stores/settingsStore'
import { BUILTIN_MODELS, fetchProviderModels, normalizeCustomBaseUrl } from '@services/modelCatalog'
import { enabledModelIds } from '@services/modelPreferences'
import { isSupportedGoModel } from '@services/opencodeGo'
import { fetchProviderBalance, hasBuiltinBalanceQuery, type ProviderBalance } from '@services/providerBalance'
import { useTokenStore, dateKey } from '@stores/tokenStore'
import { loadChatGPTModels, useChatGPTStore } from '@stores/chatgptStore'
import ChatGPTSettings from './ChatGPTSettings'
import AddProviderPicker from './AddProviderPicker'
import ui from './SettingsDialog.module.css'
import styles from './ModelsSettings.module.css'

type Draft = ProviderConnectionSettings & { model: string; availableModels: string[] }
function initialDraft(id: AIProvider): Draft {
  const state = useSettingsStore.getState()
  const connection = getProviderConnection(id)
  const models = id === 'chatgpt' ? useChatGPTStore.getState().models.map(item => item.id)
    : connection.availableModels ?? (BUILTIN_MODELS[id] ?? BUILTIN_MODELS.custom).map(item => item.id)
  const preferred = connection.model || (state.provider === id ? state.model : PROVIDER_DEFAULT_MODEL[id] || '')
  const catalog = id !== 'chatgpt' && preferred && !models.includes(preferred) ? [...models, preferred] : models
  const enabled = enabledModelIds(catalog, connection.enabledModels)
  return { ...connection, availableModels: catalog, model: enabled.includes(preferred) ? preferred : enabled[0] || '' }
}

export default function ApiSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const settings = useSettingsStore()
  const auth = useChatGPTStore()
  const tokens = useTokenStore()
  const [provider, setProvider] = useState<AIProvider>(() => {
    const ids = getVisibleProviderIds(settings)
    return ids.includes(settings.provider) ? settings.provider : ids[0] || settings.provider
  })
  const [nextActive, setNextActive] = useState<AIProvider | null>(settings.providerDisabled ? null : settings.provider)
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => ({ [provider]: initialDraft(provider) }))
  const [dirtyIds, setDirtyIds] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [manualModel, setManualModel] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [fetching, setFetching] = useState<AIProvider | null>(null)
  const [balanceBusy, setBalanceBusy] = useState(false)
  const [balances, setBalances] = useState<Record<string, ProviderBalance>>({})
  const balanceAbortController = useRef<AbortController | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)
  const requestVersion = useRef(0)
  const accountId = useRef(auth.activeId)
  const dirty = dirtyIds.length > 0 || nextActive !== (settings.providerDisabled ? null : settings.provider)
  const draft = drafts[provider] || initialDraft(provider)
  const catalog = provider === 'chatgpt' ? auth.models.map(item => item.id) : draft.availableModels
  const enabled = enabledModelIds(catalog, draft.enabledModels)
  const custom = isCustomProviderId(provider)
  const names = useMemo(() => new Map(auth.models.map(item => [item.id, item.name])), [auth.models])
  const shownModels = catalog.filter(id => `${id} ${provider === 'chatgpt' ? names.get(id) || '' : ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const providerIds = getVisibleProviderIds(settings)
  const hasSelection = providerIds.includes(provider)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestVersion.current++; balanceAbortController.current?.abort() } }, [])
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  // A newly authorized/switched account must not inherit another account's model switches.
  useEffect(() => {
    const changedAccount = accountId.current !== auth.activeId
    accountId.current = auth.activeId
    setDrafts(previous => {
      if (!previous.chatgpt || changedAccount) return { ...previous, chatgpt: initialDraft('chatgpt') }
      const ids = auth.models.map(item => item.id)
      const current = previous.chatgpt
      const allowed = enabledModelIds(ids, current.enabledModels)
      return { ...previous, chatgpt: { ...current, availableModels: ids, model: allowed.includes(current.model) ? current.model : allowed[0] || '' } }
    })
    if (changedAccount) { setDirtyIds(ids => ids.filter(id => id !== 'chatgpt')); setNotice('') }
  }, [auth.activeId, auth.models])

  function cancelBalanceQuery() {
    balanceAbortController.current?.abort()
    balanceAbortController.current = null
    setBalanceBusy(false)
  }
  function patch(id: AIProvider, value: Partial<Draft>) {
    if (value.apiKey !== undefined || value.baseUrl !== undefined || value.usageQuery !== undefined) {
      cancelBalanceQuery()
      setBalances(previous => { const copy = { ...previous }; delete copy[id]; return copy })
    }
    setDrafts(previous => ({ ...previous, [id]: { ...(previous[id] || initialDraft(id)), ...value } }))
    setDirtyIds(previous => previous.includes(id) ? previous : [...previous, id])
    setNotice(''); setError('')
  }
  function chooseProvider(id: AIProvider) {
    cancelBalanceQuery()
    setDrafts(previous => previous[id] ? previous : { ...previous, [id]: initialDraft(id) })
    setProvider(id); setQuery(''); setManualModel(''); setShowKey(false); setNotice(''); setError(''); setAdding(false)
  }
  function toggleModel(id: string, checked: boolean) {
    const next = checked ? [...enabled, id] : enabled.filter(item => item !== id)
    patch(provider, { enabledModels: next, model: next.includes(draft.model) ? draft.model : next[0] || '' })
  }
  async function refreshModels() {
    const id = provider, request = ++requestVersion.current
    setFetching(id); setError(''); setNotice('')
    try {
      if (id === 'chatgpt') {
        await loadChatGPTModels()
        if (useChatGPTStore.getState().modelError) throw new Error(useChatGPTStore.getState().modelError)
      } else {
        if (!draft.apiKey.trim()) throw new Error('请先填写 API Key，再刷新模型目录。')
        const ids = await fetchProviderModels(id, draft.apiKey, { customBaseUrl: draft.baseUrl })
        if (!mounted.current || request !== requestVersion.current) return
        setDrafts(previous => {
          const current = previous[id] || initialDraft(id)
          const allowed = enabledModelIds(ids, current.enabledModels)
          return { ...previous, [id]: { ...current, availableModels: ids, model: allowed.includes(current.model) ? current.model : allowed[0] || '' } }
        })
        setDirtyIds(previous => previous.includes(id) ? previous : [...previous, id])
      }
    } catch (error) {
      if (mounted.current && request === requestVersion.current) setError(error instanceof Error ? error.message : '模型目录加载失败。')
    } finally { if (mounted.current && request === requestVersion.current) setFetching(null) }
  }
  function addModel() {
    const id = manualModel.trim()
    if (!id) return
    if (provider === 'opencode-go' && !isSupportedGoModel(id)) { setError('此 Go 模型的接口格式尚未适配，请从模型目录选择。'); return }
    const next = Array.from(new Set([...catalog, id]))
    patch(provider, { availableModels: next, enabledModels: Array.from(new Set([...enabled, id])), model: draft.model || id })
    setManualModel(''); setQuery('')
  }
  function removeProvider(id: AIProvider) {
    const name = drafts[id]?.name || getProviderDisplayName(id)
    const detail = id === 'chatgpt' ? '移除列表和模型配置，保留本机 ChatGPT 登录。' : '清除该服务商的 API Key 和连接配置。'
    if (!window.confirm(`删除 ${name}？${detail}\n不会删除课程与对话。若正在使用此服务商，将暂停新的 AI 请求，不会自动切换计费通道。`)) return
    requestVersion.current++; setFetching(null)
    cancelBalanceQuery()
    settings.removeProvider(id)
    setDrafts(previous => { const copy = { ...previous }; delete copy[id]; return copy })
    setDirtyIds(ids => ids.filter(value => value !== id))
    setBalances(previous => { const copy = { ...previous }; delete copy[id]; return copy })
    if (nextActive === id) setNextActive(null)
    const remaining = getVisibleProviderIds(useSettingsStore.getState())
    if (provider === id && remaining.length) chooseProvider(remaining[0])
    setError(''); setNotice(`已删除 ${name}，可通过“添加服务商”重新添加。`)
  }
  function save() {
    const selected = drafts[nextActive || provider] || initialDraft(nextActive || provider)
    const activating = nextActive !== null && (nextActive !== settings.provider || settings.providerDisabled)
    if (activating && nextActive) {
      if (nextActive === 'chatgpt' ? !auth.planEnabled : !selected.apiKey.trim() || !selected.baseUrl.trim()) {
        setError('请先完成所选服务商的连接配置，再将其设为当前服务商。'); return
      }
      if (!enabledModelIds(selected.availableModels, selected.enabledModels).length) { setError('请至少启用一个模型。'); return }
    }
    for (const id of dirtyIds as AIProvider[]) {
      const value = drafts[id]
      if (!value) continue
      if (id !== 'chatgpt' && value.baseUrl.trim()) {
        try { if (!['http:', 'https:'].includes(new URL(value.baseUrl.trim()).protocol)) throw new Error() }
        catch { setError(`${value.name} 的 API 地址无效，请填写完整的 HTTP(S) 地址。`); return }
      }
    }
    for (const id of dirtyIds as AIProvider[]) {
      const value = drafts[id]
      if (!value) continue
      const ids = id === 'chatgpt' ? auth.models.map(item => item.id) : value.availableModels
      const allowed = enabledModelIds(ids, value.enabledModels)
      settings.setProviderConnection(id, {
        ...value, name: value.name.trim() || '自定义供应商', apiKey: id === 'chatgpt' ? '' : value.apiKey.trim(),
        baseUrl: id === 'chatgpt' ? '' : normalizeCustomBaseUrl(value.baseUrl),
        model: allowed.includes(value.model) ? value.model : allowed[0] || '',
        availableModels: ids,
      })
    }
    // Merely editing a provider never changes billing. Activation requires an explicit user action + Save.
    if (activating && nextActive) settings.setProvider(nextActive)
    if (nextActive && (dirtyIds.includes(nextActive) || activating)) {
      settings.setModel(getProviderConnection(nextActive).model || selected.model || '')
    }
    setDirtyIds([]); setError(''); setNotice('已保存')
  }
  async function queryBalance() {
    if (balanceAbortController.current) return
    const id = provider
    const controller = new AbortController()
    balanceAbortController.current = controller
    setBalanceBusy(true); setError('')
    setBalances(previous => { const copy = { ...previous }; delete copy[id]; return copy })
    try {
      const result = await fetchProviderBalance(id, draft.apiKey, { customBaseUrl: draft.baseUrl, customUsageQuery: draft.usageQuery }, controller.signal)
      if (mounted.current && !controller.signal.aborted && getVisibleProviderIds().includes(id)) setBalances(previous => ({ ...previous, [id]: result }))
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : '额度查询失败。')
    } finally {
      if (balanceAbortController.current === controller) {
        balanceAbortController.current = null
        if (mounted.current) setBalanceBusy(false)
      }
    }
  }
  const canQueryBalance = provider !== 'chatgpt' && Boolean(draft.apiKey.trim()) && (hasBuiltinBalanceQuery(provider) || (draft.usageQuery?.enabled && Boolean(draft.usageQuery.script.trim())))

  return <div className={styles.editor} data-ui-font-min="10">
    <div className={styles.body}>
      <aside className={styles.sidebar} aria-label="模型服务商">
        <div className={styles.providerList}>
          {providerIds.map(id => {
            const value = drafts[id] || initialDraft(id)
            const ids = id === 'chatgpt' ? auth.models.map(item => item.id) : value.availableModels
            return <div key={id} className={styles.providerItem}><button type="button" className={`${styles.provider} ${id === provider ? styles.selectedProvider : ''}`} aria-pressed={id === provider} onClick={() => chooseProvider(id)}>
              <span className={styles.providerIcon}><ProviderIcon provider={id} name={value.name} size={18} /></span>
              <span className={styles.providerName} title={value.name || id}>{value.name || id}</span>
              {!settings.providerDisabled && id === settings.provider && <i className={styles.currentProvider} title="当前使用" aria-label="当前使用" />}
              <span className={styles.providerCount}>{enabledModelIds(ids, value.enabledModels).length}/{ids.length}{dirtyIds.includes(id) ? ' *' : ''}</span>
            </button><button type="button" className={styles.removeProvider} aria-label={`删除 ${value.name || id}`} title={`删除 ${value.name || id}`} onClick={() => removeProvider(id)}><Trash2 size={14} /></button></div>
          })}
        </div>
        <div className={styles.addProvider}>
          <button type="button" className={styles.addButton} aria-haspopup="dialog" aria-expanded={adding} onClick={() => setAdding(true)}><Plus size={18} />添加服务商</button>
        </div>
      </aside>
      <div className={styles.content}>
        {!hasSelection ? <div className={styles.empty}>尚未添加服务商，请点击左侧“添加服务商”。</div> : <>
        {provider === 'chatgpt' ? <ChatGPTSettings /> : <section className={styles.connection}>
          <div className={styles.providerHeading}>
            <div><h2>{draft.name}</h2></div>
            <div className={ui.actions}>
              <span className={styles.status}><i />{draft.apiKey.trim() ? '已配置' : '未配置'}</span>
              {canQueryBalance && <button type="button" className={ui.button} disabled={balanceBusy} title={balances[provider]?.detail || (provider === 'opencode-go' ? '查询 5 小时、每周和每月套餐余量，不发起模型请求' : '查询余额')} onClick={() => { void queryBalance() }}>{balanceBusy ? '查询中…' : balances[provider]?.text || (provider === 'opencode-go' ? '查询余量' : '查询余额')}</button>}
            </div>
          </div>
          <div className={styles.fields}>
            <label className={styles.field}>API Key<div className={styles.keyInput}>
              <input className={styles.input} type={showKey ? 'text' : 'password'} value={draft.apiKey} placeholder="输入你的 API Key" autoComplete="off" spellCheck={false} onChange={event => patch(provider, { apiKey: event.target.value })} />
              <button type="button" className={ui.iconButton} aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey(value => !value)}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </div></label>
          </div>
        </section>}

        <section className={styles.models}>
          <div className={styles.sectionHeading}>
            <div className={ui.actions}><h3>可用模型</h3><span className={styles.hint} title="启用的模型出现在 Athena 菜单中；默认模型用于学习内容生成。">{enabled.length}/{catalog.length} 已启用</span></div>
            <div className={ui.actions}>
              <button type="button" className={ui.button} disabled={!catalog.length} onClick={() => patch(provider, { enabledModels: [...catalog], model: draft.model || catalog[0] || '' })} aria-label="全部开启" title="全部开启">全开</button>
              <button type="button" className={ui.button} disabled={!enabled.length} onClick={() => patch(provider, { enabledModels: [], model: '' })} aria-label="全部关闭" title="全部关闭">全关</button>
              <button type="button" className={ui.button} disabled={Boolean(fetching) || (provider === 'chatgpt' && !auth.planEnabled)} onClick={() => { void refreshModels() }} aria-label="刷新模型目录" title={fetching === provider ? '刷新中…' : '刷新模型目录'}><RefreshCw size={14} className={fetching === provider ? styles.spinning : ''} /></button>
            </div>
          </div>
          <div className={styles.search}><Search size={16} /><input aria-label="筛选模型" value={query} onChange={event => setQuery(event.target.value)} placeholder={`筛选 ${catalog.length} 个模型…`} /></div>
          <div className={styles.modelList} aria-label="可用模型列表">
            {shownModels.map(id => <div key={id} className={styles.modelRow}>
              <div className={styles.modelName} title={provider === 'chatgpt' ? `${names.get(id) || id} · ${id}` : id}><span>{provider === 'chatgpt' ? names.get(id) || id : id}</span></div>
              <button type="button" className={`${styles.defaultModel} ${draft.model === id ? styles.isDefault : ''}`} disabled={!enabled.includes(id)} aria-pressed={draft.model === id} onClick={() => patch(provider, { model: id })} aria-label={`将 ${id} 设为默认模型`} title={`将 ${id} 设为默认模型`}>
                {draft.model === id ? <><Check size={12} />默认</> : '默认'}
              </button>
              <button type="button" className={ui.switch} role="switch" aria-checked={enabled.includes(id)} aria-label={`启用 ${id}`} onClick={() => toggleModel(id, !enabled.includes(id))} />
            </div>)}
            {!shownModels.length && <div className={styles.empty}>{query ? '没有匹配的模型。' : provider === 'chatgpt' && !auth.planEnabled ? '先连接 ChatGPT，即可查看账号可用模型。' : '暂无模型，请刷新目录或手动添加模型 ID。'}</div>}
          </div>
        </section>

        <details className={styles.auxiliary} key={provider} open={custom && !getProviderConnection(provider).baseUrl.trim() ? true : undefined}>
          <summary>更多设置<span className={styles.hint}>{provider === 'chatgpt' ? '本机统计 · 官方用量页' : '连接地址 · 手动模型 · 本机统计'}</span><ChevronDown size={14} /></summary>
          <div className={styles.auxiliaryBody}>
            {provider !== 'chatgpt' && <>
              <div className={styles.fields}>
                {custom && <label className={styles.field}>服务商名称<input className={styles.input} value={draft.name} onChange={event => patch(provider, { name: event.target.value })} /></label>}
                <label className={styles.field}>API 地址<input className={styles.input} type="url" value={draft.baseUrl} readOnly={provider === 'opencode-go'} title={provider === 'opencode-go' ? '固定官方 Go 套餐端点，通过本机转发。' : undefined} placeholder="https://api.example.com/v1" autoComplete="off" spellCheck={false} onChange={event => patch(provider, { baseUrl: event.target.value })} /></label>
              </div>
              <div className={styles.manualModel}><input className={styles.input} aria-label="手动添加模型 ID" value={manualModel} onChange={event => setManualModel(event.target.value)} placeholder="手动添加模型 ID" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addModel() } }} /><button type="button" className={ui.button} disabled={!manualModel.trim()} onClick={addModel}><Plus size={14} />添加</button></div>
              {!getProviderConnection(provider).availableModels && <p className={styles.hint}>当前为内置参考目录，请刷新以确认账号权限。</p>}
            </>}
            {provider === 'opencode-go' && <p className={styles.hint}>使用 Go 套餐 API Key；内置只读额度查询，无需脚本。点击“查询余量”获取 5 小时、每周和每月额度，悬停查看重置时间。超额是否付费由 OpenCode 控制台设置决定。</p>}
        {provider !== 'chatgpt' && provider !== 'opencode-go' && <details className={styles.advanced}>
          <summary>高级设置<ChevronDown size={16} /></summary>
          <div className={styles.advancedBody}>
            {provider === 'deepseek' && <label className={styles.checkbox}><input type="checkbox" checked={settings.fastResponses} onChange={event => settings.setFastResponses(event.target.checked)} />优先快速响应（即时生效）</label>}
            <label className={styles.checkbox}><input type="checkbox" checked={draft.usageQuery?.enabled || false} onChange={event => patch(provider, { usageQuery: { enabled: event.target.checked, script: draft.usageQuery?.script || DEFAULT_CUSTOM_USAGE_SCRIPT } })} />自定义余额查询</label>
            <p className={styles.hint}>仅在你信任脚本来源时启用。余额查询不会自动执行。</p>
            <textarea className={styles.code} aria-label="余额查询脚本" spellCheck={false} disabled={!draft.usageQuery?.enabled} value={draft.usageQuery?.script || DEFAULT_CUSTOM_USAGE_SCRIPT} onChange={event => patch(provider, { usageQuery: { enabled: draft.usageQuery?.enabled || false, script: event.target.value } })} />
            <button type="button" className={ui.button} onClick={() => patch(provider, { usageQuery: { enabled: draft.usageQuery?.enabled || false, script: DEFAULT_CUSTOM_USAGE_SCRIPT } })}>恢复默认脚本</button>
          </div>
        </details>}
        <section className={styles.usage} aria-label="本机所有服务商用量合计，不代表套餐剩余额度">
          <div className={styles.usageStats}>
            <span>今日 Tokens<strong>{(tokens.daily[dateKey()]?.total || 0).toLocaleString()}</strong></span>
            <span>累计 Tokens<strong>{tokens.total.total.toLocaleString()}</strong></span>
            <span>调用<strong>{tokens.callCount.toLocaleString()}</strong></span>
          </div>
          <button type="button" className={ui.danger} onClick={() => { if (window.confirm('清空本机 Token 与调用统计？不会影响账单、课程和对话。')) tokens.resetStats() }}>重置统计</button>
          {provider === 'chatgpt' && <a href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noreferrer">官方用量页 ↗</a>}
          {provider === 'opencode-go' && <a href="https://opencode.ai/console" target="_blank" rel="noreferrer">OpenCode 官方控制台 ↗</a>}
          <p className={styles.hint}>以上为所有服务商的本机合计，不代表套餐余量。</p>
        </section>
          </div>
        </details>
        {provider === 'chatgpt' && auth.modelError && <p className={styles.error} role="alert">{auth.modelError}</p>}
        </>}
      </div>
    </div>
    {adding && <AddProviderPicker
      configured={BUILTIN_PROVIDER_IDS.filter(id => providerIds.includes(id))}
      onSelect={id => { settings.addProvider(id); chooseProvider(id) }}
      onAddCustom={() => { const id = settings.addCustomProvider() as AIProvider; chooseProvider(id) }}
      onClose={() => setAdding(false)}
    />}
    <footer className={styles.footer}>
      <div aria-live="polite" className={error ? styles.error : styles.hint}>{error || notice || (dirty ? '有未保存的更改' : settings.providerDisabled ? '未选择当前服务商' : `当前：${getProviderDisplayName(settings.provider)} · ${settings.model || '自动选择模型'}`)}</div>
      <div className={ui.actions}>
        {hasSelection && provider !== nextActive && <button type="button" className={ui.button} disabled={!enabled.length} onClick={() => { setNextActive(provider); setNotice('保存后将切换当前服务商。') }}>设为当前服务商</button>}
        <button type="button" className={ui.primary} onClick={save} disabled={!dirty || Boolean(fetching)}>保存</button>
      </div>
    </footer>
  </div>
}
