import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AthenaPanelState {
  isOpen: boolean
  isExpanded: boolean
  navigationOpen: boolean
  draft: string
  pendingPrefill: string | null
  panelWidth: number | null
  setPanelWidth: (width: number) => void
  open: (prefill?: string) => void
  close: () => void
  toggle: () => void
  toggleExpanded: () => void
  exitExpanded: () => void
  toggleNavigation: () => void
  setDraft: (draft: string) => void
  consumePrefill: () => string | null
}

/** 两侧面板独立开关；收起时保留会话与草稿，刷新后恢复布局。 */
export const useAthenaPanelStore = create<AthenaPanelState>()(persist((set, get) => ({
  isOpen: false,
  isExpanded: false,
  navigationOpen: true,
  draft: '',
  pendingPrefill: null,
  panelWidth: null,
  setPanelWidth: width => {
    if (Number.isFinite(width)) set({ panelWidth: Math.max(240, Math.min(720, width)) })
  },
  open: (prefill) => set({
    isOpen: true,
    pendingPrefill: typeof prefill === 'string' && prefill.trim() ? prefill : null,
  }),
  close: () => set({ isOpen: false, isExpanded: false }),
  toggle: () => set(state => ({ isOpen: !state.isOpen, isExpanded: false })),
  toggleExpanded: () => {
    if (get().isOpen) set(state => ({ isExpanded: !state.isExpanded }))
  },
  exitExpanded: () => set({ isExpanded: false }),
  toggleNavigation: () => set(state => ({ navigationOpen: !state.navigationOpen })),
  setDraft: draft => set({ draft }),
  consumePrefill: () => {
    const prefill = get().pendingPrefill
    set({ pendingPrefill: null })
    return prefill
  },
}), {
  name: 'chillpass-panel-layout',
  partialize: state => ({
    isOpen: state.isOpen,
    isExpanded: state.isExpanded,
    navigationOpen: state.navigationOpen,
    draft: state.draft,
    pendingPrefill: state.pendingPrefill,
    panelWidth: state.panelWidth,
  }),
  merge: (persisted, current) => {
    const saved = (persisted ?? {}) as Partial<AthenaPanelState>
    const isOpen = saved.isOpen === true
    const panelWidth = typeof saved.panelWidth === 'number' && Number.isFinite(saved.panelWidth)
      ? Math.max(240, Math.min(720, saved.panelWidth)) : null
    return { ...current, ...saved, panelWidth, isOpen, isExpanded: isOpen && saved.isExpanded === true }
  },
}))
