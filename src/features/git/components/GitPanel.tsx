import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, GitBranch, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { CommitDialog } from './CommitDialog'
import { DiffView } from './DiffView'

import { gitService } from '@/services/gitService'
import { useProjectStore } from '@/stores/useProjectStore'
import type { FileChange, GitBranch as GitBranchType, GitStatus } from '@/types/git'

const RECENT_REPOS_KEY = 'flydex.recentRepos'

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

/** 记住最近打开的仓库（去重，最近在前，最多 8 个） */
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
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjectStore((s) => s.projects)

  const project = projects.find((p) => p.id === currentProjectId) ?? null
  const projectPath = project?.path?.trim() ?? ''

  const [manualRepo, setManualRepo] = useState('')
  const [recentRepos, setRecentRepos] = useState<string[]>(loadRecentRepos)
  const [repoInput, setRepoInput] = useState('')
  const [opening, setOpening] = useState(false)
  const repoInputRef = useRef<HTMLInputElement>(null)

  // 仓库解析：手动打开 > 项目路径
  const repo = manualRepo || projectPath

  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<GitBranchType[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCommit, setShowCommit] = useState(false)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)

  const loadStatus = useCallback(async () => {
    if (!repo) {
      setStatus(null)
      setBranches([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [st, br] = await Promise.all([gitService.status(repo), gitService.branches(repo)])
      setStatus(st)
      setBranches(br)
      if (selectedPath && !st.changes.some((c) => c.path === selectedPath)) {
        setSelectedPath(null)
      }
    } catch (e) {
      setError(String(e))
      setStatus(null)
      setBranches([])
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

  // 打开仓库（文件夹对话框）
  const pickRepo = async () => {
    setError(null)
    const dir = await open({
      directory: true,
      multiple: false,
      title: '选择 Git 仓库文件夹',
    })
    if (typeof dir !== 'string' || !dir) return
    setOpening(true)
    try {
      // 验证是否为 git 仓库
      await gitService.status(dir)
      setManualRepo(dir)
      rememberRepo(dir)
      setRecentRepos(loadRecentRepos())
      setRepoInput('')
    } catch (e) {
      setError(`无法打开仓库：${String(e)}`)
    } finally {
      setOpening(false)
    }
  }

  // 打开仓库（手动输入路径）
  const openRepo = async (path: string) => {
    const trimmed = path.trim()
    if (!trimmed) return
    setOpening(true)
    setError(null)
    try {
      await gitService.status(trimmed)
      setManualRepo(trimmed)
      rememberRepo(trimmed)
      setRecentRepos(loadRecentRepos())
      setRepoInput('')
    } catch (e) {
      setError(`无法打开仓库：${String(e)}`)
    } finally {
      setOpening(false)
    }
  }

  // 分组
  const stagedChanges = (status?.changes ?? []).filter((c) => c.staged)
  const unstagedChanges = (status?.changes ?? []).filter((c) => !c.staged && c.unstaged)

  const selectedChange = status?.changes.find((c) => c.path === selectedPath) ?? null

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 工具栏：项目路径 + 分支 + 刷新 */}
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
                  title="切换分支"
                >
                  <span className="max-w-[160px] truncate font-medium">
                    {status?.branch || '…'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">▼</span>
                </button>
                {branchMenuOpen && status && (
                  <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg">
                    {branches.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">无分支</div>
                    )}
                    {branches.map((b) => (
                      <button
                        key={b.name}
                        onClick={() => handleCheckout(b.name)}
                        className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-accent ${
                          b.current ? 'text-accent-foreground' : 'text-foreground'
                        }`}
                      >
                        <span className="truncate">{b.name}</span>
                        {b.current && (
                          <span className="text-[10px] text-muted-foreground">当前</span>
                        )}
                      </button>
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
          <button
            onClick={handleRefresh}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="刷新"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* 主体：左侧变更列表 + 右侧 diff */}
      <div className="flex flex-1 overflow-hidden">
        {/* 变更列表 */}
        <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border">
          {!repo && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8">
              <div className="w-full max-w-md">
                <h3 className="mb-2 text-sm font-medium text-foreground">打开 Git 仓库</h3>
                {/* 主入口：文件夹对话框 */}
                <button
                  onClick={() => void pickRepo()}
                  disabled={opening}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FolderOpen className="h-4 w-4" />
                  {opening ? '打开中…' : '选择文件夹'}
                </button>

                {/* 手动输入路径（备用） */}
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

                {/* 当前项目快捷方式 */}
                {projectPath && (
                  <div className="mt-3">
                    <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                      当前项目
                    </div>
                    <button
                      onClick={() => void openRepo(projectPath)}
                      className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-accent/50"
                      title={projectPath}
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono">{projectPath}</span>
                    </button>
                  </div>
                )}

                {/* 最近仓库 */}
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
                        <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-mono">{path}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {repo && !status && !error && (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              {loading ? '加载中…' : '不是 Git 仓库'}
            </div>
          )}

          {status && (
            <>
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
                />
              ))}
            </>
          )}
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

      {/* 底部提交栏 */}
      {status && status.changes.length > 0 && (
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

      {/* 提交对话框 */}
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
    </div>
  )
}

/** 变更行 */
function ChangeRow({
  change,
  selected,
  onSelect,
}: {
  change: FileChange
  selected: boolean
  onSelect: () => void
}) {
  const badge = stateBadge(change)
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
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
    </button>
  )
}
