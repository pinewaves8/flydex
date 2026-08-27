import { open } from '@tauri-apps/plugin-dialog'
import { create } from 'zustand'

const CWD_KEY = 'flydex.workspace.cwd'
const DEFAULT_CWD = 'C:\\llm\\flydex'

/** 读取持久化的工作目录 */
function loadInitialCwd(): string {
  try {
    const saved = localStorage.getItem(CWD_KEY)
    if (saved) return saved
  } catch {
    // ignore
  }
  return DEFAULT_CWD
}

interface WorkspaceState {
  /** 全局当前工作目录（唯一事实源，Codex/Terminal/Git/Projects 共享） */
  cwd: string
  /** 设置工作目录并持久化 */
  setCwd: (path: string) => void
  /** 弹出文件夹对话框选择工作目录 */
  openFolder: () => Promise<string | null>
}

/**
 * 全局工作区 Store
 *
 * 遵循 codex 的工作方式：cwd（当前目录）是唯一事实源，
 * 所有面板（Codex Chat / Terminal / Git / Projects）共享同一个目录。
 * 切换目录 = 全局切换工作区。
 */
export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  cwd: loadInitialCwd(),

  setCwd: (path) => {
    const p = path.trim()
    if (!p) return
    try {
      localStorage.setItem(CWD_KEY, p)
    } catch {
      // ignore
    }
    set({ cwd: p })
  },

  openFolder: async () => {
    const dir = await open({ directory: true, multiple: false, title: '选择工作目录' })
    if (typeof dir === 'string' && dir) {
      useWorkspaceStore.getState().setCwd(dir)
      return dir
    }
    return null
  },
}))
