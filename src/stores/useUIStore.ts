import { create } from 'zustand'

export type View = 'codex' | 'projects' | 'terminal' | 'git' | 'files' | 'settings'
export type SettingsTab = 'security' | 'model' | 'mcp' | 'skills' | 'terminal'

interface UIState {
  sidebarCollapsed: boolean
  currentView: View
  /** 设置页当前 tab */
  settingsTab: SettingsTab
  toggleSidebar: () => void
  setCurrentView: (view: View) => void
  /** 打开设置页并切换到指定 tab（如点盾牌直达沙箱权限） */
  openSettings: (tab: SettingsTab) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  currentView: 'codex',
  settingsTab: 'security',
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setCurrentView: (view) => set({ currentView: view }),
  openSettings: (tab) => set({ currentView: 'settings', settingsTab: tab }),
}))
