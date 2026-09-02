import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'

/** 终端 Shell 类型 */
export type ShellType = 'auto' | 'pwsh' | 'powershell' | 'cmd' | 'wsl'

interface SettingsState {
  theme: Theme
  model: string
  apiBase: string
  codexPath: string
  /** 内置终端使用的 Shell（auto = 自动探测 pwsh → powershell → cmd） */
  shell: ShellType
  /** 会话完成时是否弹系统通知 */
  notifyOnDone: boolean
  /** 任务失败时是否弹系统通知 */
  notifyOnError: boolean
  /** 审批请求时是否弹系统通知（建议保持开启） */
  notifyOnApproval: boolean
  setTheme: (theme: Theme) => void
  setModel: (model: string) => void
  setApiBase: (base: string) => void
  setCodexPath: (path: string) => void
  setShell: (shell: ShellType) => void
  setNotifyOnDone: (v: boolean) => void
  setNotifyOnError: (v: boolean) => void
  setNotifyOnApproval: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      model: '',
      apiBase: '',
      codexPath: 'codex',
      shell: 'auto',
      notifyOnDone: false,
      notifyOnError: true,
      notifyOnApproval: true,
      setTheme: (theme) => set({ theme }),
      setModel: (model) => set({ model }),
      setApiBase: (base) => set({ apiBase: base }),
      setCodexPath: (path) => set({ codexPath: path }),
      setShell: (shell) => set({ shell }),
      setNotifyOnDone: (v) => set({ notifyOnDone: v }),
      setNotifyOnError: (v) => set({ notifyOnError: v }),
      setNotifyOnApproval: (v) => set({ notifyOnApproval: v }),
    }),
    { name: 'flydex-settings' },
  ),
)
