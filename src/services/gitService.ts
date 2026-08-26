import { invoke } from '@tauri-apps/api/core'

import type { CommitResult, GitBranch, GitStatus } from '@/types/git'

/**
 * Git 管理 Service
 *
 * 封装与 Tauri 后端 Git 相关的 IPC 调用。
 */
export const gitService = {
  /** 获取 git 状态（变更列表 + 当前分支） */
  async status(repo: string): Promise<GitStatus> {
    return invoke<GitStatus>('git_status', { repo })
  },

  /** 获取所有分支 */
  async branches(repo: string): Promise<GitBranch[]> {
    return invoke<GitBranch[]>('git_branches', { repo })
  },

  /** 切换分支 */
  async checkout(repo: string, branch: string): Promise<void> {
    await invoke('git_checkout', { repo, branch })
  },

  /** 获取单个文件的未暂存 diff */
  async diff(repo: string, path: string): Promise<string> {
    return invoke<string>('git_diff', { repo, path })
  },

  /** 获取单个文件的已暂存 diff */
  async diffCached(repo: string, path: string): Promise<string> {
    return invoke<string>('git_diff_cached', { repo, path })
  },

  /** 暂存指定 hunk */
  async stageHunk(repo: string, path: string, hunkIndex: number): Promise<void> {
    await invoke('git_stage_hunk', { repo, path, hunkIndex })
  },

  /** 取消暂存指定 hunk */
  async unstageHunk(repo: string, path: string, hunkIndex: number): Promise<void> {
    await invoke('git_unstage_hunk', { repo, path, hunkIndex })
  },

  /** 提交 */
  async commit(repo: string, message: string): Promise<CommitResult> {
    return invoke<CommitResult>('git_commit', { repo, message })
  },
}
