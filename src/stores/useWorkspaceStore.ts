import { confirm, open } from '@tauri-apps/plugin-dialog'
import { create } from 'zustand'

import { gitService } from '@/services/gitService'

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

/**
 * 打开非 git 目录时引导初始化 git 仓库。
 *
 * git 仓库是文件变更卡片（diff/回滚）与 Git 面板的前提；
 * 初始化后 Codex 的文件修改可查看 diff 并可回滚（强烈建议）。
 * 用户取消则保持非 git 模式（文件变更不显示 diff 卡片）。
 */
async function ensureGitRepo(dir: string) {
  try {
    if (await gitService.isRepo(dir)) return
    const yes = await confirm(
      `"${dir}" 不是 Git 仓库。\n\n是否初始化 Git 仓库？\n初始化后：Codex 文件变更可查看 diff 并可回滚、Git 面板可用（强烈建议）。\n提示：初始化后建议先在 Git 面板做一次首次提交，之后所有文件修改都会显示 diff 卡片。\n\n取消则保持非 Git 模式。`,
      { title: '初始化 Git 仓库', kind: 'warning' },
    )
    if (yes) await gitService.init(dir)
  } catch {
    // 静默：检测/初始化失败不影响打开目录
  }
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
    // 非 git 目录引导初始化（覆盖 TitleBar / Projects 所有打开入口）
    void ensureGitRepo(p)
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
