import { GitBranch, Loader2, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { gitService } from '@/services/gitService'
import type { GitRemote } from '@/types/git'

/**
 * 同步对话框：push / pull / fetch + 远端管理
 */
export function SyncDialog({
  repo,
  branch,
  remotes,
  onClose,
  onMutated,
}: {
  repo: string
  branch: string
  remotes: GitRemote[]
  onClose: () => void
  onMutated: () => void
}) {
  const [tab, setTab] = useState<'push' | 'pull' | 'remote'>('push')
  const [remote, setRemote] = useState(remotes[0]?.name ?? '')
  const [force, setForce] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  // 远端管理状态
  const [remoteList, setRemoteList] = useState<GitRemote[]>(remotes)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')

  useEffect(() => {
    if (!remote && remoteList.length > 0) setRemote(remoteList[0].name)
  }, [remoteList, remote])

  const runSync = async (type: 'push' | 'pull') => {
    setRunning(true)
    setResult(null)
    try {
      const r =
        type === 'push'
          ? await gitService.push(repo, remote, branch, force)
          : await gitService.pull(repo, remote, branch)
      setResult({ ok: r.ok, message: r.message })
      if (r.ok) onMutated()
    } catch (e) {
      setResult({ ok: false, message: String(e) })
    } finally {
      setRunning(false)
    }
  }

  const handleFetch = async () => {
    setRunning(true)
    setResult(null)
    try {
      const r = await gitService.fetch(repo, remote)
      setResult({ ok: r.ok, message: r.message })
      if (r.ok) onMutated()
    } catch (e) {
      setResult({ ok: false, message: String(e) })
    } finally {
      setRunning(false)
    }
  }

  const addRemote = async () => {
    if (!newName.trim() || !newUrl.trim()) return
    try {
      await gitService.addRemote(repo, newName.trim(), newUrl.trim())
      setRemoteList(await gitService.remotes(repo))
      setNewName('')
      setNewUrl('')
    } catch (e) {
      setResult({ ok: false, message: String(e) })
    }
  }

  const removeRemote = async (name: string) => {
    try {
      await gitService.removeRemote(repo, name)
      setRemoteList(await gitService.remotes(repo))
      if (remote === name) setRemote(remoteList[0]?.name ?? '')
    } catch (e) {
      setResult({ ok: false, message: String(e) })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex h-[520px] w-[560px] max-w-[92vw] flex-col rounded-lg border border-border bg-background shadow-xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">同步</h3>
            <span className="text-xs text-muted-foreground">当前分支: {branch}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab */}
        <div className="flex border-b border-border px-2">
          {(['push', 'pull', 'remote'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-t px-4 py-2 text-sm transition-colors ${
                tab === t
                  ? 'border-b-2 border-primary font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'push' ? '推送' : t === 'pull' ? '拉取' : '远端'}
            </button>
          ))}
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* push/pull 共用：远端选择 + 执行 */}
          {tab !== 'remote' && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">远端</label>
                <select
                  value={remote}
                  onChange={(e) => setRemote(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {remoteList.length === 0 && <option value="">无远端</option>}
                  {remoteList.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name} ({r.url})
                    </option>
                  ))}
                </select>
                {remoteList.length === 0 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    未配置远端，请到"远端"标签添加
                  </p>
                )}
              </div>

              {tab === 'push' && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={force}
                    onChange={(e) => setForce(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  强制推送（--force，覆盖远端历史，谨慎使用）
                </label>
              )}

              <button
                onClick={() => (tab === 'push' ? runSync('push') : runSync('pull'))}
                disabled={running || remoteList.length === 0}
                className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    执行中…
                  </span>
                ) : tab === 'push' ? (
                  '推送'
                ) : (
                  '拉取'
                )}
              </button>
            </div>
          )}

          {/* 远端管理 */}
          {tab === 'remote' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="名称，如 origin"
                  className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="URL，如 https://github.com/user/repo.git"
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={() => void addRemote()}
                  className="shrink-0 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-1">
                {remoteList.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">暂无远端</p>
                )}
                {remoteList.map((r) => (
                  <div
                    key={r.name}
                    className="group flex items-center gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <span className="w-24 shrink-0 truncate text-sm font-medium">{r.name}</span>
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                      title={r.url}
                    >
                      {r.url}
                    </span>
                    <button
                      onClick={() => void removeRemote(r.name)}
                      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                      title="移除远端"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 结果展示 */}
          {result && (
            <div
              className={`mt-4 rounded-md border px-3 py-2 text-xs whitespace-pre-wrap ${
                result.ok
                  ? 'border-green-600/30 bg-green-600/10 text-green-600'
                  : 'border-destructive/30 bg-destructive/10 text-destructive'
              }`}
            >
              {result.message}
            </div>
          )}
        </div>

        {/* 底部：fetch 快捷按钮 */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <button
            onClick={() => void handleFetch()}
            disabled={running}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {running ? '执行中…' : '仅拉取更新（fetch，不合并）'}
          </button>
        </div>
      </div>
    </div>
  )
}
