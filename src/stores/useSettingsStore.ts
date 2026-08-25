import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'

interface SettingsState {
  theme: Theme
  model: string
  apiBase: string
  codexPath: string
  setTheme: (theme: Theme) => void
  setModel: (model: string) => void
  setApiBase: (base: string) => void
  setCodexPath: (path: string) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      model: '',
      apiBase: '',
      codexPath: 'codex',
      setTheme: (theme) => set({ theme }),
      setModel: (model) => set({ model }),
      setApiBase: (base) => set({ apiBase: base }),
      setCodexPath: (path) => set({ codexPath: path }),
    }),
    { name: 'flydex-settings' },
  ),
)
