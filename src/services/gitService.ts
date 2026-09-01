import { invoke } from '@tauri-apps/api/core'

import type {
  CommitResult,
  GitBranch,
  GitCommit,
  GitRemote,
  GitStatus,
  GitSyncResult,
} from '@/types/git'

/**
 * Git 管理 Service
 *
 * 封装与 Tauri 后端 Git 相关的 IPC 调用。
 */
export const gitService = {
  /** 判断目录是否为 git 仓库 */
  async isRepo(repo: string): Promise<boolean> {
    return invoke<boolean>('git_is_repo', { repo })
  },

  /** 初始化 git 仓库 */
  async init(repo: string): Promise<void> {
    await invoke('git_init', { repo })
  },

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

  // ── 分支管理 ──

  /** 创建分支 */
  async createBranch(repo: string, name: string, base?: string): Promise<void> {
    await invoke('git_create_branch', { repo, name, base: base ?? null })
  },

  /** 重命名分支 */
  async renameBranch(repo: string, oldName: string, newName: string): Promise<void> {
    await invoke('git_rename_branch', { repo, oldName, newName })
  },

  /** 删除分支 */
  async deleteBranch(repo: string, name: string): Promise<void> {
    await invoke('git_delete_branch', { repo, name })
  },

  // ── 远端与同步 ──

  /** 获取远端列表 */
  async remotes(repo: string): Promise<GitRemote[]> {
    return invoke<GitRemote[]>('git_remotes', { repo })
  },

  /** 添加远端 */
  async addRemote(repo: string, name: string, url: string): Promise<void> {
    await invoke('git_add_remote', { repo, name, url })
  },

  /** 移除远端 */
  async removeRemote(repo: string, name: string): Promise<void> {
    await invoke('git_remove_remote', { repo, name })
  },

  /** 拉取远端更新 */
  async fetch(repo: string, remote?: string): Promise<GitSyncResult> {
    return invoke<GitSyncResult>('git_fetch', { repo, remote: remote ?? null })
  },

  /** 推送 */
  async push(
    repo: string,
    remote?: string,
    branch?: string,
    force = false,
  ): Promise<GitSyncResult> {
    return invoke<GitSyncResult>('git_push', {
      repo,
      remote: remote ?? null,
      branch: branch ?? null,
      force,
    })
  },

  /** 拉取并合并 */
  async pull(repo: string, remote?: string, branch?: string): Promise<GitSyncResult> {
    return invoke<GitSyncResult>('git_pull', {
      repo,
      remote: remote ?? null,
      branch: branch ?? null,
    })
  },

  // ── 暂存与放弃 ──

  /** 暂存整个文件 */
  async stageFile(repo: string, path: string): Promise<void> {
    await invoke('git_stage_file', { repo, path })
  },

  /** 取消暂存整个文件 */
  async unstageFile(repo: string, path: string): Promise<void> {
    await invoke('git_unstage_file', { repo, path })
  },

  /** 暂存全部 */
  async stageAll(repo: string): Promise<void> {
    await invoke('git_stage_all', { repo })
  },

  /** 取消暂存全部 */
  async unstageAll(repo: string): Promise<void> {
    await invoke('git_unstage_all', { repo })
  },

  /** 放弃工作区改动（单文件或全部） */
  async discardChanges(repo: string, path?: string): Promise<void> {
    await invoke('git_discard_changes', { repo, path: path ?? null })
  },

  // ── 提交历史 ──

  /** 提交历史列表 */
  async log(repo: string, limit = 50): Promise<GitCommit[]> {
    return invoke<GitCommit[]>('git_log', { repo, limit })
  },

  /** 查看提交详情 */
  async show(repo: string, hash: string): Promise<string> {
    return invoke<string>('git_show', { repo, hash })
  },
}
