import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Maximize2, Minimize2, HelpCircle, RefreshCw, WalletCards, PanelLeft, ChevronDown } from 'lucide-react'
import {
  BUILTIN_PROVIDER_IDS,
  getProviderConnection,
  getProviderDisplayName,
  PROVIDER_DEFAULT_MODEL,
  useSettingsStore,
  type AIProvider,
} from '@stores/settingsStore'
import { useAthenaPanelStore } from '@stores/athenaPanelStore'
import { refreshChatGPTStatus, useChatGPTStore } from '@stores/chatgptStore'
import {
  fetchProviderBalance,
  hasBuiltinBalanceQuery,
  type ProviderBalance,
} from '@services/providerBalance'
import { connectCodexUsage, confirmCodexUsageConnection } from '@services/chatgptUsage'
import { useT } from '../../i18n'
import GlobalSearch from './GlobalSearch'
import ProviderIcon from '@components/common/ProviderIcon'
import styles from './TitleBar.module.css'

/**
 * macOS 风格窗口标题栏
 * 红黄绿三个圆点：关闭、最小化、最大化
 * 右侧显示搜索、帮助和专注模式按钮
 */
export default function TitleBar() {
  const navigate = useNavigate()
  const navigationOpen = useAthenaPanelStore(s => s.navigationOpen)
  const toggleNavigation = useAthenaPanelStore(s => s.toggleNavigation)
  const [isMaximized, setIsMaximized] = useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const [balance, setBalance] = useState<ProviderBalance | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceError, setBalanceError] = useState('')
  const providerMenuRef = useRef<HTMLDivElement>(null)
  const balanceRequestRunning = useRef(false)
  const balanceAbortController = useRef<AbortController | null>(null)
  const provider = useSettingsStore(s => s.provider)
  const providerDisabled = useSettingsStore(s => s.providerDisabled)
  const removedProviderIds = useSettingsStore(s => s.removedProviderIds)
  const providerConnections = useSettingsStore(s => s.providerConnections)
  const customProviderIds = useSettingsStore(s => s.customProviderIds)
  const setProvider = useSettingsStore(s => s.setProvider)
  const setModel = useSettingsStore(s => s.setModel)
  const t = useT()
  const chatGPTReady = useChatGPTStore(s => s.planEnabled)
  const chatGPTAccountId = useChatGPTStore(s => s.activeId)
  const chatGPTUsageConnected = useChatGPTStore(s => s.usageConnected)
  useEffect(() => {
    const refresh = () => { void refreshChatGPTStatus().catch(() => {}) }
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  // 浏览器模式下隐藏窗口控制按钮
  const isBrowser = window.electronAPI?.platform === 'browser'

  useEffect(() => {
    // 获取初始最大化状态
    window.electronAPI?.windowIsMaximized().then(setIsMaximized)
    // 监听最大化状态变化
    const maxCleanup = window.electronAPI?.onWindowMaximizeChange(setIsMaximized)

    // 获取初始全屏（专注）状态
    window.electronAPI?.isFullScreen().then(setIsFocusMode)
    // 监听专注模式退出回调
    const focusCleanup = window.electronAPI?.onFocusExited(() => {
      setIsFocusMode(false)
    })

    return () => {
      maxCleanup?.()
      focusCleanup?.()
    }
  }, [])

  const providerState = { ...useSettingsStore.getState(), providerConnections, customProviderIds }
  const activeConnection = getProviderConnection(provider, providerState)
  const providerLabel = providerDisabled ? '未选择服务商' : getProviderDisplayName(provider, providerState)
  const providerKey = activeConnection.apiKey
  const customUsageQuery = activeConnection.usageQuery ?? { enabled: false, script: '' }
  const builtinBalanceQuery = hasBuiltinBalanceQuery(provider)
  const canQueryBalance = !providerDisabled && (provider === 'chatgpt' || (providerKey.trim().length > 0
    && (builtinBalanceQuery || (customUsageQuery.enabled && customUsageQuery.script.trim().length > 0))))

  const allProviderMenuItems = [
    ...BUILTIN_PROVIDER_IDS,
    ...(customProviderIds ?? []),
  ].filter((id, index, list) => list.indexOf(id) === index) as AIProvider[]
  const providerMenuItems = allProviderMenuItems.filter(id => {
    if ((removedProviderIds || []).includes(id)) return false
    const connection = getProviderConnection(id, providerState)
    const hasKey = connection.apiKey.trim().length > 0
    const hasBaseUrl = connection.baseUrl.trim().length > 0
    const configured = id === 'chatgpt' ? chatGPTReady : id.startsWith('custom:') || id === 'custom'
      ? hasKey && hasBaseUrl
      : hasKey
    return configured || id === provider
  })

  const handleProviderChange = (next: AIProvider) => {
    if (next !== provider || providerDisabled) {
      setProvider(next)
      const connection = getProviderConnection(next)
      setModel(connection.enabledModels !== undefined
        ? connection.model || connection.enabledModels[0] || ''
        : next === 'chatgpt' ? connection.model || '' : connection.model || PROVIDER_DEFAULT_MODEL[next] || PROVIDER_DEFAULT_MODEL.custom)
    }
    setProviderMenuOpen(false)
  }

  const handleBalanceClick = () => {
    if (!canQueryBalance) {
      setProviderMenuOpen(false)
      navigate('/settings/api')
      return
    }
    if (provider === 'chatgpt' && chatGPTAccountId && !chatGPTUsageConnected) {
      if (confirmCodexUsageConnection()) void refreshBalance(true)
      return
    }
    void refreshBalance()
  }

  const refreshBalance = useCallback(async (connect = false) => {
    const key = providerKey.trim()
    if (!canQueryBalance || balanceRequestRunning.current) return

    balanceRequestRunning.current = true
    setBalanceLoading(true)
    setBalanceError('')
    const controller = new AbortController()
    balanceAbortController.current = controller
    try {
      const result = connect && chatGPTAccountId
        ? await connectCodexUsage(chatGPTAccountId, controller.signal)
        : await fetchProviderBalance(
        provider,
        key,
        {
          customBaseUrl: activeConnection.baseUrl,
          customUsageQuery,
        },
        controller.signal,
      )
      if (!controller.signal.aborted) {
        if (connect) useChatGPTStore.setState({ usageConnected: true })
        setBalance(result)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setBalance(null)
        setBalanceError(error instanceof Error ? error.message : '余量查询失败，请重试。')
      }
    } finally {
      if (balanceAbortController.current === controller) {
        balanceRequestRunning.current = false
        setBalanceLoading(false)
      }
    }
  }, [activeConnection.baseUrl, canQueryBalance, customUsageQuery, provider, providerKey, chatGPTAccountId])

  useEffect(() => {
    // 更换供应商或 Key 后回到未查询状态；余额仅由用户点击触发。
    balanceAbortController.current?.abort()
    balanceAbortController.current = null
    balanceRequestRunning.current = false
    setBalance(null)
    setBalanceLoading(false)
    setBalanceError('')
    return () => { balanceAbortController.current?.abort() }
  }, [provider, providerKey, chatGPTAccountId, chatGPTReady, providerDisabled])

  useEffect(() => {
    if (!providerMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (providerMenuRef.current && !providerMenuRef.current.contains(event.target as Node)) {
        setProviderMenuOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProviderMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [providerMenuOpen])

  const balanceText = providerDisabled ? '配置服务商' : balanceLoading ? t('titlebar.balanceLoading')
    : balanceError ? (provider === 'chatgpt' || provider === 'opencode-go' ? '余量查询失败' : t('titlebar.balanceUnavailable'))
    : provider === 'chatgpt' && chatGPTAccountId && !chatGPTUsageConnected ? '连接 Codex 额度'
    : balance?.text ?? (provider === 'chatgpt' ? '查询余量'
      : !builtinBalanceQuery && !customUsageQuery.enabled
        ? t('titlebar.balanceUnsupported')
        : !canQueryBalance ? t('titlebar.balanceNoKey') : provider === 'opencode-go' ? '查询余量' : t('titlebar.balanceQuery'))

  const handleClose = () => {
    window.electronAPI?.windowClose()
  }

  const handleMinimize = () => {
    window.electronAPI?.windowMinimize()
  }

  const handleMaximize = () => {
    window.electronAPI?.windowMaximize()
  }

  const handleFocusToggle = () => {
    if (isFocusMode) {
      window.electronAPI?.exitFocusMode()
      setIsFocusMode(false)
    } else {
      // 进入专注
      window.electronAPI?.enterFocusMode()
      setIsFocusMode(true)
    }
  }

  return (
    <div className={styles.titleBar}>
      <button
        type="button"
        className={styles.panelToggle}
        onClick={toggleNavigation}
        aria-controls="app-navigation"
        aria-expanded={navigationOpen}
        aria-label={t(navigationOpen ? 'layout.hideNavigation' : 'layout.showNavigation')}
        title={t(navigationOpen ? 'layout.hideNavigation' : 'layout.showNavigation')}
      >
        <PanelLeft size={19} strokeWidth={1.7} />
      </button>
      {!isBrowser && (
        <div className={styles.trafficLights}>
          <button
            className={styles.light}
            style={{ '--light-color': '#ff5f57' } as React.CSSProperties}
            onClick={handleClose}
            title={t('titlebar.close')}
            aria-label={t('titlebar.close')}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M1.5 1.5L6.5 6.5M6.5 1.5L1.5 6.5" stroke="#000" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
            </svg>
          </button>
          <button
            className={styles.light}
            style={{ '--light-color': '#febc2e' } as React.CSSProperties}
            onClick={handleMinimize}
            title={t('titlebar.minimize')}
            aria-label={t('titlebar.minimize')}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M1.5 4H6.5" stroke="#000" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
            </svg>
          </button>
          <button
            className={styles.light}
            style={{ '--light-color': '#28c840' } as React.CSSProperties}
            onClick={handleMaximize}
            title={isMaximized ? t('titlebar.restore') : t('titlebar.maximize')}
            aria-label={t('titlebar.maximize')}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M2 2L6 2L6 6M6 2L2 6" stroke="#000" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
            </svg>
          </button>
        </div>
      )}

      <div className={styles.centerArea} ref={providerMenuRef}>
        <div className={`${styles.providerBalancePill} ${provider === 'opencode-go' ? styles.goQuotaPill : ''} ${balanceError ? styles.balanceBadgeError : ''}`}>
          <button
            type="button"
            className={styles.providerHalf}
            onClick={() => setProviderMenuOpen(open => !open)}
            title={t('titlebar.providerSwitch')}
            aria-haspopup="menu"
            aria-expanded={providerMenuOpen}
          >
            {providerDisabled ? <WalletCards size={13} strokeWidth={2} /> : <ProviderIcon provider={provider} name={providerLabel} size={17} />}
            <span>{providerLabel}</span>
            <ChevronDown
              size={12}
              strokeWidth={2.2}
              className={`${styles.providerChevron} ${providerMenuOpen ? styles.providerChevronOpen : ''}`}
            />
          </button>
          <button
            type="button"
            className={styles.balanceHalf}
            onClick={handleBalanceClick}
            title={balanceError ? `${balanceError}\n点击重试`
              : balanceLoading ? t('titlebar.balanceLoading')
              : provider === 'chatgpt' && chatGPTAccountId && !chatGPTUsageConnected ? '连接本机官方 Codex 的同账号订阅额度（仅查询，不改变模型授权）'
              : balance?.detail ? `${balance.detail}\n${t('titlebar.balanceRefresh')}`
              : !canQueryBalance ? t('settings.api')
              : provider === 'opencode-go' ? '查询 OpenCode Go 的 5 小时、每周和每月套餐余量（不发起模型请求）'
              : balance ? t('titlebar.balanceRefresh') : t('titlebar.balanceQuery')
            }
            aria-label={`${providerLabel}: ${balanceText}`}
            disabled={balanceLoading}
          >
            <span className={styles.balanceValue}>{balanceText}</span>
            {balanceLoading && <RefreshCw size={11} className={styles.balanceSpinner} />}
          </button>
        </div>
        {providerMenuOpen && (
          <div className={styles.providerMenu} role="menu">
            {providerMenuItems.map(id => (
              <button
                key={id}
                type="button"
                className={`${styles.providerMenuItem} ${provider === id ? styles.providerMenuItemActive : ''}`}
                onClick={() => handleProviderChange(id)}
                role="menuitemradio"
                aria-checked={provider === id}
              >
                <ProviderIcon provider={id} name={getProviderDisplayName(id, providerState)} size={18} /><span>{getProviderDisplayName(id, providerState)}</span>
              </button>
            ))}
            <button
              type="button"
              className={`${styles.providerMenuItem} ${styles.providerMenuSettingsItem}`}
              onClick={() => {
                setProviderMenuOpen(false)
                navigate('/settings/api')
              }}
              role="menuitem"
            >
              <span>{t('settings.api')}</span>
            </button>
          </div>
        )}
      </div>

      <div className={styles.rightArea}>
        <GlobalSearch />
        {/* 帮助按钮 — 圆形问号 */}
        <button
          className={styles.helpBtn}
          onClick={() => setShowHelp(true)}
          title={t('titlebar.help')}
          aria-label={t('titlebar.help')}
        >
          <HelpCircle size={16} strokeWidth={2} />
        </button>

        <button
          className={`${styles.focusBtn} ${isFocusMode ? styles.focusBtnActive : ''}`}
          onClick={handleFocusToggle}
          title={isFocusMode ? t('titlebar.exitFocus') : t('titlebar.focusMode')}
        >
          {isFocusMode ? (
            <>
              <Minimize2 size={13} strokeWidth={2} />
              <span>{t('titlebar.exitFocus')}</span>
            </>
          ) : (
            <>
              <Maximize2 size={13} strokeWidth={2} />
              <span>{t('titlebar.focusMode')}</span>
            </>
          )}
        </button>
      </div>

      {/* 帮助弹窗 */}
      {showHelp && (
        <div className={styles.helpOverlay} onClick={() => setShowHelp(false)}>
          <div
            className={`${styles.helpModal} liquid-glass`}
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.helpHeader}>
              <HelpCircle size={28} strokeWidth={1.8} />
              <h2 className={styles.helpTitle}>{t('titlebar.helpTitle')}</h2>
            </div>

            <div className={styles.helpBody}>
              <section className={styles.helpSection}>
                <h3 className={styles.helpSectionTitle}>{t('titlebar.helpIntroTitle')}</h3>
                <p className={styles.helpText}>
                  {t('titlebar.helpIntroBody')}
                </p>
              </section>

              <section className={styles.helpSection}>
                <h3 className={styles.helpSectionTitle}>{t('titlebar.helpQuickTitle')}</h3>
                <ul className={styles.helpList}>
                  <li><b>{t('titlebar.helpItem1T')}</b>：{t('titlebar.helpItem1D')}</li>
                  <li><b>{t('titlebar.helpItem2T')}</b>：{t('titlebar.helpItem2D')}</li>
                  <li><b>{t('titlebar.helpItem3T')}</b>：{t('titlebar.helpItem3D')}</li>
                  <li><b>{t('titlebar.helpItem4T')}</b>：{t('titlebar.helpItem4D')}</li>
                  <li><b>{t('titlebar.helpItem5T')}</b>：{t('titlebar.helpItem5D')}</li>
                  <li><b>{t('titlebar.helpItem6T')}</b>：{t('titlebar.helpItem6D')}</li>
                </ul>
              </section>

              <section className={styles.helpSection}>
                <h3 className={styles.helpSectionTitle}>{t('titlebar.helpContactTitle')}</h3>
                <div className={styles.helpContact}>
                  <div className={styles.helpContactRow}>
                    <span className={styles.helpContactLabel}>GitHub</span>
                    <span className={styles.helpContactValue}>github.com/CYRickyArAr/ChillPass</span>
                  </div>
                  <div className={styles.helpContactRow}>
                    <span className={styles.helpContactLabel}>{t('titlebar.helpWechat')}</span>
                    <span className={styles.helpContactValue}>Eikawa_Koi</span>
                  </div>
                  <div className={styles.helpContactRow}>
                    <span className={styles.helpContactLabel}>{t('titlebar.helpVersionLabel')}</span>
                    <span className={styles.helpContactValue}>{t('titlebar.helpVersionValue')}</span>
                  </div>
                </div>
                <div className={styles.helpQr}>
                  <img src="qrcode.jpg" alt={t('titlebar.helpQrAlt')} />
                  <span>{t('titlebar.helpQrText')}</span>
                </div>
              </section>
            </div>

            <button
              className={styles.helpConfirmBtn}
              onClick={() => setShowHelp(false)}
            >
              {t('titlebar.helpGotIt')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
