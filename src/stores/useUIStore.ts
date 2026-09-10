import { create } from 'zustand'

export type View = 'codex' | 'projects' | 'terminal' | 'git' | 'files' | 'settings'
export type SettingsTab = 'security' | 'model' | 'mcp' | 'skills' | 'hooks' | 'terminal'

interface UIState {
  sidebarCollapsed: boolean
  currentView: View
  /** 设置页当前 tab */
  settingsTab: SettingsTab
  /** 全局对话搜索浮层(Ctrl+R) */
  searchOpen: boolean
  toggleSidebar: () => void
  setCurrentView: (view: View) => void
  /** 打开设置页并切换到指定 tab（如点盾牌直达沙箱权限） */
  openSettings: (tab: SettingsTab) => void
  setSearchOpen: (v: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  currentView: 'codex',
  settingsTab: 'security',
  searchOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setCurrentView: (view) => set({ currentView: view }),
  openSettings: (tab) => set({ currentView: 'settings', settingsTab: tab }),
  setSearchOpen: (v) => set({ searchOpen: v }),
}))
