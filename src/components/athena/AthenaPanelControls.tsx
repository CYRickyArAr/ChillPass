import { Maximize2, Minimize2, PanelRight } from 'lucide-react'
import { useAthenaPanelStore } from '@stores/athenaPanelStore'
import { useT } from '../../i18n'
import styles from './AthenaPanelControls.module.css'

/** 收起时位于学习顶栏，展开时位于聊天顶栏；两处使用相同尺寸和右边距。 */
export default function AthenaPanelControls() {
  const t = useT()
  const isOpen = useAthenaPanelStore(s => s.isOpen)
  const isExpanded = useAthenaPanelStore(s => s.isExpanded)
  const toggle = useAthenaPanelStore(s => s.toggle)
  const toggleExpanded = useAthenaPanelStore(s => s.toggleExpanded)

  return (
    <div className={styles.controls}>
      {isOpen && (
        <button
          id="athena-panel-expand"
          type="button"
          className={styles.button}
          onClick={toggleExpanded}
          aria-controls="athena-side-chat"
          aria-pressed={isExpanded}
          aria-label={t(isExpanded ? 'athena.restorePanel' : 'athena.expandPanel')}
          title={t(isExpanded ? 'athena.restorePanel' : 'athena.expandPanel')}
        >
          {isExpanded ? <Minimize2 size={19} strokeWidth={1.7} /> : <Maximize2 size={19} strokeWidth={1.7} />}
        </button>
      )}
      <button
        id="athena-panel-toggle"
        type="button"
        className={`${styles.button} ${isOpen ? styles.active : ''}`}
        onClick={() => {
          toggle()
          // 关闭后按钮交回学习顶栏，等 DOM 更新完成再恢复键盘焦点。
          if (isOpen) window.requestAnimationFrame(() => document.getElementById('athena-panel-toggle')?.focus())
        }}
        aria-controls="athena-side-chat"
        aria-expanded={isOpen}
        aria-label={t(isOpen ? 'athena.hideSidebar' : 'athena.showSidebar')}
        title={t(isOpen ? 'athena.hideSidebar' : 'athena.showSidebar')}
      >
        <PanelRight size={20} strokeWidth={1.7} />
      </button>
    </div>
  )
}
