import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useLocation } from 'react-router-dom'
import { useAthenaPanelStore } from '@stores/athenaPanelStore'
import AIChatPage from '../../pages/AIChatPage'
import styles from './AthenaDrawer.module.css'

/** 兼容旧书签，不再挂载第二个聊天页面或第二套请求逻辑。 */
export function LegacyAthenaRoute() {
  const location = useLocation()
  const open = useAthenaPanelStore(s => s.open)
  const prefill = (location.state as { prefill?: unknown } | null)?.prefill
  useEffect(() => {
    open(typeof prefill === 'string' ? prefill : undefined)
  }, [open, prefill])
  return <Navigate to="/" replace />
}

export default function AthenaDrawer() {
  const isOpen = useAthenaPanelStore(s => s.isOpen)
  const isExpanded = useAthenaPanelStore(s => s.isExpanded)
  const panelWidth = useAthenaPanelStore(s => s.panelWidth)
  const setPanelWidth = useAthenaPanelStore(s => s.setPanelWidth)
  const drawerRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ pointerId: number; left: number; right: number; offset: number; latest: number } | null>(null)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const widthAnimationRef = useRef<number | null>(null)
  const previousModeRef = useRef(`${isOpen}:${isExpanded}`)
  const [shellWidth, setShellWidth] = useState(1000)
  const minWidth = Math.min(340, shellWidth)
  const maxWidth = Math.max(minWidth, Math.min(720, shellWidth - 320))
  const clampWidth = (width: number) => Math.max(minWidth, Math.min(maxWidth, width))

  useEffect(() => {
    const shell = drawerRef.current?.parentElement
    if (!shell) return
    const observer = new ResizeObserver(() => setShellWidth(shell.clientWidth))
    setShellWidth(shell.clientWidth)
    observer.observe(shell)
    return () => observer.disconnect()
  }, [])

  // Window listeners survive the handle disappearing during collapse/fullscreen.
  // Only release/cancel ends this gesture; crossing a threshold never does.
  useEffect(() => {
    const finishDrag = () => {
      if (dragRef.current) setPanelWidth(Math.max(minWidth, Math.min(maxWidth, dragRef.current.latest)))
      dragRef.current = null
      setDragWidth(null)
    }
    const moveDrag = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      const boundary = event.clientX - drag.offset
      const requested = drag.right - boundary
      drag.latest = Math.max(minWidth, Math.min(maxWidth, requested))
      setDragWidth(drag.latest)
      // The pointer must reach the actual full-width edge, not maxWidth + a fixed delta.
      const expanded = boundary <= drag.left + 8
      const open = expanded || requested > Math.max(0, minWidth - 80)
      const state = useAthenaPanelStore.getState()
      if (state.isOpen !== open || state.isExpanded !== expanded) {
        useAthenaPanelStore.setState({ isOpen: open, isExpanded: expanded })
      }
    }
    const releaseDrag = (event: globalThis.PointerEvent) => {
      if (event.pointerId === dragRef.current?.pointerId) finishDrag()
    }
    window.addEventListener('pointermove', moveDrag)
    window.addEventListener('pointerup', releaseDrag)
    window.addEventListener('pointercancel', releaseDrag)
    window.addEventListener('blur', finishDrag)
    return () => {
      window.removeEventListener('pointermove', moveDrag)
      window.removeEventListener('pointerup', releaseDrag)
      window.removeEventListener('pointercancel', releaseDrag)
      window.removeEventListener('blur', finishDrag)
    }
  }, [minWidth, maxWidth, setPanelWidth])

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !drawerRef.current) return
    event.preventDefault()
    const rect = drawerRef.current.getBoundingClientRect()
    const shell = drawerRef.current.parentElement!.getBoundingClientRect()
    const width = rect.width
    dragRef.current = { pointerId: event.pointerId, left: shell.left, right: shell.right, offset: event.clientX - rect.left, latest: clampWidth(width) }
    setDragWidth(width)
  }
  const width = dragWidth ?? (panelWidth === null ? null : clampWidth(panelWidth))
  const targetWidth = !isOpen ? 0 : isExpanded ? shellWidth
    : width ?? clampWidth(Math.max(340, Math.min(480, window.innerWidth * 0.32)))
  useLayoutEffect(() => {
    const drawer = drawerRef.current
    if (!drawer) return
    const mode = `${isOpen}:${isExpanded}`
    const shouldAnimate = previousModeRef.current !== mode || widthAnimationRef.current !== null
    previousModeRef.current = mode
    if (widthAnimationRef.current !== null) cancelAnimationFrame(widthAnimationRef.current)
    widthAnimationRef.current = null
    const startWidth = drawer.getBoundingClientRect().width
    const writeWidth = (value: number) => drawer.style.setProperty('--athena-render-width', `${value}px`)
    if (!shouldAnimate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      writeWidth(targetWidth)
      return
    }
    const startedAt = performance.now()
    // Animate actual pixels independently of flex classes and pointer-state rerenders.
    const frame = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - startedAt) / 240))
      writeWidth(startWidth + (targetWidth - startWidth) * (1 - Math.pow(1 - progress, 3)))
      widthAnimationRef.current = progress < 1 ? requestAnimationFrame(frame) : null
    }
    widthAnimationRef.current = requestAnimationFrame(frame)
  }, [targetWidth, isOpen, isExpanded])
  useEffect(() => () => {
    if (widthAnimationRef.current !== null) cancelAnimationFrame(widthAnimationRef.current)
  }, [])
  // 首次打开才启动聊天界面；之后仅隐藏，避免切页/收起中断回复。
  const [hasOpened, setHasOpened] = useState(isOpen)
  useEffect(() => {
    if (isOpen) setHasOpened(true)
  }, [isOpen])

  return (
    <>
    <aside ref={drawerRef} id="athena-side-chat" className={`${styles.drawer} ${isExpanded ? styles.drawerExpanded : ''}`} hidden={!isOpen} aria-label="Athena">
      {!isExpanded && <div
        className={styles.resizeHandle}
        role="separator"
        tabIndex={0}
        aria-label="调整 Athena 宽度"
        aria-orientation="vertical"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={Math.round(width ?? clampWidth(drawerRef.current?.clientWidth ?? 340))}
        title="向左拖到工作区边缘可全屏；向右拖过最小宽度可收起；松手前可拉回"
        onPointerDown={startDrag}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          setPanelWidth(clampWidth((width ?? drawerRef.current?.clientWidth ?? 340) + (event.key === 'ArrowLeft' ? 24 : -24)))
        }}
      />}
      {(isOpen || hasOpened) && <AIChatPage visible={isOpen} />}
    </aside>
    {dragWidth !== null && createPortal(<div className={styles.resizeShield} />, document.body)}
    </>
  )
}
