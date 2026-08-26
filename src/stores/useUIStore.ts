import { create } from 'zustand'

export type View = 'codex' | 'projects' | 'terminal' | 'git' | 'settings'

interface UIState {
  sidebarCollapsed: boolean
  currentView: View
  toggleSidebar: () => void
  setCurrentView: (view: View) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  currentView: 'codex',
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setCurrentView: (view) => set({ currentView: view }),
}))
