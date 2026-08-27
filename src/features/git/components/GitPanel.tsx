import { open } from '@tauri-apps/plugin-dialog'
import {
  Check,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { CommitDialog } from './CommitDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { DiffView } from './DiffView'
import { HistoryView } from './HistoryView'
import { SyncDialog } from './SyncDialog'

import { gitService } from '@/services/gitService'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'
import type { FileChange, GitBranch as GitBranchType, GitRemote, GitStatus } from '@/types/git'

const RECENT_REPOS_KEY = 'flydex.recentRepos'
type Tab = 'changes' | 'history' | 'stash'

/** 读取最近打开的仓库列表 */
function loadRecentRepos(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_REPOS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** 记住最近打开的仓库 */
function rememberRepo(path: string): void {
  try {
    const list = [path, ...loadRecentRepos().filter((p) => p !== path)].slice(0, 8)
    localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

/** 根据文件状态返回徽标颜色 */
function stateBadge(change: FileChange): { label: string; cls: string } {
  if (change.state === 'untracked') return { label: 'U', cls: 'bg-gray-500' }
  if (change.state === 'deleted') return { label: 'D', cls: 'bg-red-600' }
  if (change.state === 'renamed') return { label: 'R', cls: 'bg-blue-600' }
  if (change.staged) return { label: 'A', cls: 'bg-green-600' }
  return { label: 'M', cls: 'bg-yellow-600' }
}

export function GitPanel() {
  // 仓库 = 全局工作目录（与 Codex/Terminal/Projects 共享同一事实源）
  const workspaceCwd = useWorkspaceStore((s) => s.cwd)
  const setWorkspaceCwd = useWorkspaceStore((s) => s.setCwd)

  const [recentRepos, setRecentRepos] = useState<string[]>(loadRecentRepos)
  const [repoInput, setRepoInput] = useState('')
  const [opening, setOpening] = useState(false)
  const repoInputRef = useRef<HTMLInputElement | null>(null)

  const [tab, setTab] = useState<Tab>('changes')
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<GitBranchType[]>([])
  const [remotes, setRemotes] = useState<GitRemote[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)

  // 对话框状态
  const [showCommit, setShowCommit] = useState(false)
  const [showSync, setShowSync] = useState(false)
  const [newBranchOpen, setNewBranchOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [newBranchSwitch, setNewBranchSwitch] = useState(false)
  const [renameBranch, setRenameBranch] = useState<GitBranchType | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteBranch, setDeleteBranch] = useState<GitBranchType | null>(null)
  const [discardPath, setDiscardPath] = useState<string | null>(null)

  // 仓库 = 全局工作目录
  const repo = workspaceCwd

  const loadStatus = useCallback(async () => {
    if (!repo) {
      setStatus(null)
      setBranches([])
      setRemotes([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [st, br, rm] = await Promise.all([
        gitService.status(repo),
        gitService.branches(repo),
        gitService.remotes(repo),
      ])
      setStatus(st)
      setBranches(br)
      setRemotes(rm)
      if (selectedPath && !st.changes.some((c) => c.path === selectedPath)) {
        setSelectedPath(null)
      }
    } catch (e) {
      setError(String(e))
      setStatus(null)
      setBranches([])
      setRemotes([])
    } finally {
      setLoading(false)
    }
  }, [repo, selectedPath])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // 切换分支
  const handleCheckout = async (branch: string) => {
    if (!repo || branch === status?.branch) return
    setBranchMenuOpen(false)
    setLoading(true)
    setError(null)
    try {
      await gitService.checkout(repo, branch)
      await loadStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = () => {
    loadStatus()
  }

  // 打开仓库（文件夹对话框）→ 同时切换全局工作目录
  const pickRepo = async () => {
    setError(null)
    const dir = await open({ directory: true, multiple: false, title: '选择 Git 仓库文件夹' })
    if (typeof dir !== 'string' || !dir) return
    setOpening(true)
    try {
      await gitService.status(dir)
      setWorkspaceCwd(dir)
      rememberRepo(dir)
      setRecentRepos(loadRecentRepos())
      setRepoInput('')
    } catch (e) {
      setError(`无法打开仓库：${String(e)}`)
    } finally {
      setOpening(false)
    }
  }

  const openRepo = async (path: string) => {
    const trimmed = path.trim()
    if (!trimmed) return
    setOpening(true)
    setError(null)
    try {
      await gitService.status(trimmed)
      setWorkspaceCwd(trimmed)
      rememberRepo(trimmed)
      setRecentRepos(loadRecentRepos())
      setRepoInput('')
    } catch (e) {
      setError(`无法打开仓库：${String(e)}`)
    } finally {
      setOpening(false)
    }
  }

  // 新建分支
  const handleCreateBranch = async () => {
    const name = newBranchName.trim()
    if (!repo || !name) return
    setError(null)
    try {
      await gitService.createBranch(repo, name, status?.branch)
      if (newBranchSwitch) {
        await gitService.checkout(repo, name)
      }
      setNewBranchOpen(false)
      setNewBranchName('')
      setNewBranchSwitch(false)
      await loadStatus()
    } catch (e) {
      setError(String(e))
    }
  }

  // 重命名分支
  const handleRenameBranch = async () => {
    if (!repo || !renameBranch) return
    const name = renameValue.trim()
    if (!name || name === renameBranch.name) {
      setRenameBranch(null)
      return
    }
    setError(null)
    try {
      await gitService.renameBranch(repo, renameBranch.name, name)
      setRenameBranch(null)
      await loadStatus()
    } catch (e) {
      setError(String(e))
      setRenameBranch(null)
    }
  }

  // 删除分支
  const handleDeleteBranch = async () => {
    if (!repo || !deleteBranch) return
    setError(null)
    try {
      await gitService.deleteBranch(repo, deleteBranch.name)
      setDeleteBranch(null)
      await loadStatus()
    } catch (e) {
      setError(String(e))
      setDeleteBranch(null)
    }
  }

  // 文件级操作
  const handleStageFile = async (path: string) => {
    if (!repo) return
    setError(null)
    try {
      await gitService.stageFile(repo, path)
      await loadStatus()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleUnstageFile = async (path: string) => {
    if (!repo) return
    setError(null)
    try {
      await gitService.unstageFile(repo, path)
      await loadStatus()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleStageAll = async () => {
    if (!repo) return
    setError(null)
    try {
      await gitService.stageAll(repo)
      await loadStatus()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleUnstageAll = async () => {
    if (!repo) return
    setError(null)
    try {
      await gitService.unstageAll(repo)
      await loadStatus()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleDiscard = async () => {
    if (!repo) return
    setError(null)
    try {
      await gitService.discardChanges(repo, discardPath ?? undefined)
      setDiscardPath(null)
      await loadStatus()
    } catch (e) {
      setError(String(e))
      setDiscardPath(null)
    }
  }

  // 分组
  const stagedChanges = (status?.changes ?? []).filter((c) => c.staged)
  const unstagedChanges = (status?.changes ?? []).filter((c) => !c.staged && c.unstaged)

  const selectedChange = status?.changes.find((c) => c.path === selectedPath) ?? null

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {repo ? (
            <>
              <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
              {/* 分支选择器 */}
              <div className="relative">
                <button
                  onClick={() => setBranchMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-sm hover:bg-accent/50"
                  title="分支管理"
                >
                  <span className="max-w-[160px] truncate font-medium">
                    {status?.branch || '…'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">▼</span>
                </button>
                {branchMenuOpen && status && (
                  <div className="absolute left-0 top-full z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg">
                    {/* 新建分支 */}
                    <button
                      onClick={() => setNewBranchOpen(true)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      新建分支
                    </button>
                    <div className="mx-2 my-1 border-t border-border" />
                    {branches.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">无分支</div>
                    )}
                    {branches.map((b) => (
                      <div
                        key={b.name}
                        className={`group flex w-full items-center px-3 py-1.5 text-sm hover:bg-accent ${
                          b.current ? 'text-accent-foreground' : 'text-foreground'
                        }`}
                      >
                        <button
                          onClick={() => handleCheckout(b.name)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span className="truncate">{b.name}</span>
                          {b.current && <Check className="h-3 w-3 shrink-0" />}
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => {
                              setRenameBranch(b)
                              setRenameValue(b.name)
                              setBranchMenuOpen(false)
                            }}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="重命名"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => {
                              setDeleteBranch(b)
                              setBranchMenuOpen(false)
                            }}
                            disabled={b.current}
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                            title={b.current ? '不能删除当前分支' : '删除分支'}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <span className="truncate text-xs text-muted-foreground" title={repo}>
                {repo}
              </span>
              {status && (status.ahead > 0 || status.behind > 0) && (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  ↑{status.ahead} ↓{status.behind}
                </span>
              )}
            </>
          ) : (
            <button
              onClick={() => void pickRepo()}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-sm hover:bg-accent/50"
            >
              <FolderOpen className="h-4 w-4" />
              打开仓库
            </button>
          )}
        </div>
        {repo && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => setShowSync(true)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent/50"
              title="同步（fetch/push/pull/远端管理）"
            >
              同步
            </button>
            <button
              onClick={handleRefresh}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="刷新"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Tab 导航 */}
      {repo && status && (
        <div className="flex border-b border-border px-2">
          {(
            [
              ['changes', '更改'],
              ['history', '历史'],
              ['stash', 'Stash'],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-t px-4 py-2 text-sm transition-colors ${
                tab === t
                  ? 'border-b-2 border-primary font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 主体 */}
      {!repo ? (
        <OpenRepoView
          repoInput={repoInput}
          setRepoInput={setRepoInput}
          opening={opening}
          repoInputRef={repoInputRef}
          pickRepo={pickRepo}
          openRepo={openRepo}
          recentRepos={recentRepos}
        />
      ) : tab === 'history' ? (
        <div className="flex-1 overflow-hidden">
          <HistoryView repo={repo} />
        </div>
      ) : tab === 'stash' ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Stash 功能将在后续版本提供
        </div>
      ) : (
        /* 更改视图 */
        <div className="flex flex-1 overflow-hidden">
          {/* 变更列表 */}
          <div className="flex w-72 shrink-0 flex-col border-r border-border">
            <div className="flex-1 overflow-y-auto">
              {!status && !error && (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {loading ? '加载中…' : '不是 Git 仓库'}
                </div>
              )}
              {status && (
                <>
                  {/* 全部操作 */}
                  <div className="flex items-center gap-1 border-b border-border px-2 py-1">
                    <button
                      onClick={() => void handleStageAll()}
                      className="flex-1 rounded px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title="暂存全部"
                    >
                      + 全部
                    </button>
                    <button
                      onClick={() => void handleUnstageAll()}
                      className="flex-1 rounded px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title="取消暂存全部"
                    >
                      - 全部
                    </button>
                  </div>

                  {/* 已暂存 */}
                  <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase text-muted-foreground">
                    已暂存变更 ({stagedChanges.length})
                  </div>
                  {stagedChanges.length === 0 && (
                    <div className="px-3 py-1 text-[10px] text-muted-foreground/60">无</div>
                  )}
                  {stagedChanges.map((change) => (
                    <ChangeRow
                      key={`staged-${change.path}`}
                      change={change}
                      selected={selectedPath === change.path}
                      onSelect={() => setSelectedPath(change.path)}
                      onUnstageFile={() => void handleUnstageFile(change.path)}
                    />
                  ))}

                  {/* 未暂存 */}
                  <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase text-muted-foreground">
                    未暂存变更 ({unstagedChanges.length})
                  </div>
                  {unstagedChanges.length === 0 && (
                    <div className="px-3 py-1 text-[10px] text-muted-foreground/60">无</div>
                  )}
                  {unstagedChanges.map((change) => (
                    <ChangeRow
                      key={`unstaged-${change.path}`}
                      change={change}
                      selected={selectedPath === change.path}
                      onSelect={() => setSelectedPath(change.path)}
                      onStageFile={() => void handleStageFile(change.path)}
                      onDiscard={() => setDiscardPath(change.path)}
                    />
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Diff 视图 */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {selectedChange ? (
              <DiffView repo={repo} change={selectedChange} onMutated={loadStatus} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                选择文件查看 Diff
              </div>
            )}
          </div>
        </div>
      )}

      {/* 底部提交栏 */}
      {repo && status && tab === 'changes' && status.changes.length > 0 && (
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2">
          <span className="text-xs text-muted-foreground">{status.changes.length} 个文件变更</span>
          <button
            onClick={() => setShowCommit(true)}
            disabled={!stagedChanges.some((c) => c.state !== 'untracked')}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            提交
          </button>
        </div>
      )}

      {/* 对话框 */}
      {showCommit && status && (
        <CommitDialog
          repo={repo}
          onCommitted={() => {
            setShowCommit(false)
            loadStatus()
          }}
          onClose={() => setShowCommit(false)}
        />
      )}
      {showSync && (
        <SyncDialog
          repo={repo}
          branch={status?.branch ?? ''}
          remotes={remotes}
          onMutated={loadStatus}
          onClose={() => setShowSync(false)}
        />
      )}
      {newBranchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[420px] max-w-[90vw] rounded-lg border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-medium">新建分支</h3>
              <button
                onClick={() => setNewBranchOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">分支名称</label>
                <input
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreateBranch()
                  }}
                  placeholder="如 feature/xxx"
                  autoFocus
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  基于当前分支：{status?.branch ?? '-'}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={newBranchSwitch}
                  onChange={(e) => setNewBranchSwitch(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                创建并切换到新分支
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                onClick={() => setNewBranchOpen(false)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
              >
                取消
              </button>
              <button
                onClick={() => void handleCreateBranch()}
                disabled={!newBranchName.trim()}
                className="rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
      {renameBranch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[420px] max-w-[90vw] rounded-lg border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-medium">重命名分支</h3>
              <button
                onClick={() => setRenameBranch(null)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-4">
              <label className="mb-1 block text-xs text-muted-foreground">新名称</label>
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRenameBranch()
                }}
                autoFocus
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                onClick={() => setRenameBranch(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
              >
                取消
              </button>
              <button
                onClick={() => void handleRenameBranch()}
                disabled={!renameValue.trim()}
                className="rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                重命名
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteBranch && (
        <ConfirmDialog
          title={`删除分支 ${deleteBranch.name}`}
          message={`确定删除分支 "${deleteBranch.name}"？\n若该分支有未合并的提交，git 将拒绝删除。`}
          confirmLabel="删除"
          cancelLabel="取消"
          danger
          onConfirm={() => void handleDeleteBranch()}
          onClose={() => setDeleteBranch(null)}
        />
      )}
      {discardPath !== null && (
        <ConfirmDialog
          title="放弃更改"
          message={`确定放弃对 "${discardPath}" 的所有未暂存修改？\n此操作不可撤销。`}
          confirmLabel="放弃"
          cancelLabel="取消"
          danger
          onConfirm={() => void handleDiscard()}
          onClose={() => setDiscardPath(null)}
        />
      )}
    </div>
  )
}

/** 变更行 */
function ChangeRow({
  change,
  selected,
  onSelect,
  onStageFile,
  onUnstageFile,
  onDiscard,
}: {
  change: FileChange
  selected: boolean
  onSelect: () => void
  onStageFile?: () => void
  onUnstageFile?: () => void
  onDiscard?: () => void
}) {
  const badge = stateBadge(change)
  return (
    <div
      onClick={onSelect}
      className={`group flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white ${badge.cls}`}
      >
        {badge.label}
      </span>
      <span className="min-w-0 flex-1 truncate" title={change.path}>
        {change.path}
      </span>
      {change.insertions > 0 && (
        <span className="shrink-0 text-[10px] text-green-600">+{change.insertions}</span>
      )}
      {change.deletions > 0 && (
        <span className="shrink-0 text-[10px] text-red-600">-{change.deletions}</span>
      )}
      {/* 文件级操作 */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {onUnstageFile && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onUnstageFile()
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="取消暂存"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {onStageFile && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onStageFile()
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="暂存文件"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
        {onDiscard && change.state !== 'untracked' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDiscard()
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            title="放弃更改"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

/** 打开仓库视图 */
function OpenRepoView({
  repoInput,
  setRepoInput,
  opening,
  repoInputRef,
  pickRepo,
  openRepo,
  recentRepos,
}: {
  repoInput: string
  setRepoInput: (v: string) => void
  opening: boolean
  repoInputRef: React.Ref<HTMLInputElement>
  pickRepo: () => void
  openRepo: (p: string) => void
  recentRepos: string[]
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8">
      <div className="w-full max-w-md">
        <h3 className="mb-2 text-sm font-medium text-foreground">打开 Git 仓库</h3>
        <button
          onClick={() => void pickRepo()}
          disabled={opening}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FolderOpen className="h-4 w-4" />
          {opening ? '打开中…' : '选择文件夹'}
        </button>
        <div className="mt-3 flex gap-2">
          <input
            ref={repoInputRef}
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void openRepo(repoInput)
            }}
            placeholder="或输入路径，如 C:\llm\flydex"
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={() => void openRepo(repoInput)}
            disabled={opening || !repoInput.trim()}
            className="shrink-0 rounded-md bg-primary/10 px-4 py-2 text-sm text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            打开
          </button>
        </div>
        {recentRepos.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
              最近打开
            </div>
            {recentRepos.map((path) => (
              <button
                key={path}
                onClick={() => void openRepo(path)}
                className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-accent/50"
                title={path}
              >
                <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono">{path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
