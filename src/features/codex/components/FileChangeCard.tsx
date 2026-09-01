import { invoke } from '@tauri-apps/api/core'
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  FileMinus2,
  FilePen,
  FilePlus2,
  Loader2,
  X,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'

import { DiffViewer } from '@/components/ui/DiffViewer'
import type { CodexFileChange, CodexMessage } from '@/types/codexJson'

const KIND_META: Record<
  CodexFileChange['kind'],
  { label: string; icon: React.ReactNode; cls: string }
> = {
  add: { label: '新增', icon: <FilePlus2 className="h-3 w-3" />, cls: 'text-green-400' },
  delete: { label: '删除', icon: <FileMinus2 className="h-3 w-3" />, cls: 'text-red-400' },
  update: { label: '修改', icon: <FilePen className="h-3 w-3" />, cls: 'text-blue-400' },
}

type Decision = 'accepted' | 'rejected'

/**
 * 文件变更卡片：内联展示 Agent 的文件修改（写入后审查模型）。
 *
 * - 文件列表：path + kind（新增/删除/修改）
 * - 点击文件懒加载 diff（git_diff_file，自动处理 tracked/untracked/删除）
 * - 接受 = 保留；拒绝 = 回滚（tracked 用 git restore，untracked 删除文件）
 * - 支持逐文件与"全部接受/全部拒绝"
 */
export function FileChangeCard({ message, repo }: { message: CodexMessage; repo?: string }) {
  const changes = message.fileChanges ?? []
  const [expanded, setExpanded] = useState(true)
  const [openPaths, setOpenPaths] = useState<Record<string, boolean>>({})
  const [diffs, setDiffs] = useState<Record<string, string>>({})
  const [loadingDiff, setLoadingDiff] = useState<Record<string, boolean>>({})
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timeStr = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  /** 展开/收起单个文件并懒加载 diff */
  const toggleDiff = async (path: string) => {
    const nextOpen = { ...openPaths, [path]: !openPaths[path] }
    setOpenPaths(nextOpen)
    if (!nextOpen[path] || diffs[path] || !repo) return
    setLoadingDiff((s) => ({ ...s, [path]: true }))
    try {
      const raw = await invoke<string>('git_diff_file', { repo, path })
      setDiffs((s) => ({ ...s, [path]: raw }))
    } catch (e) {
      setDiffs((s) => ({ ...s, [path]: `# 无法获取 diff: ${String(e)}` }))
    } finally {
      setLoadingDiff((s) => ({ ...s, [path]: false }))
    }
  }

  /** 单文件接受/拒绝 */
  const decide = async (path: string, accept: boolean) => {
    if (!repo || decisions[path]) return
    setBusy(true)
    setError(null)
    try {
      if (!accept) {
        await invoke('git_discard_file', { repo, path })
      }
      setDecisions((s) => ({ ...s, [path]: accept ? 'accepted' : 'rejected' }))
    } catch (e) {
      setError(`拒绝 ${path} 失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 全部接受/拒绝 */
  const decideAll = async (accept: boolean) => {
    if (!repo) return
    setBusy(true)
    setError(null)
    try {
      const pending = changes.filter((c) => !decisions[c.path])
      if (!accept) {
        for (const c of pending) {
          await invoke('git_discard_file', { repo, path: c.path })
        }
      }
      setDecisions((s) => {
        const next = { ...s }
        for (const c of pending) next[c.path] = accept ? 'accepted' : 'rejected'
        return next
      })
    } catch (e) {
      setError(`操作失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const decidedCount = Object.keys(decisions).length
  const pendingCount = changes.length - decidedCount

  return (
    <div className="rounded border-l-2 border-l-violet-500 bg-violet-500/5 py-2 pl-3">
      {/* 头部 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mb-1 flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="text-violet-300">File Change</span>
        <span className="font-mono">{changes.length} 个文件</span>
        {pendingCount > 0 && <span className="text-amber-300">{pendingCount} 待处理</span>}
        <span className="ml-auto flex items-center gap-0.5 text-[10px] opacity-50">{timeStr}</span>
      </button>

      {expanded && (
        <div className="space-y-1.5">
          {/* 文件列表 */}
          <div className="space-y-1">
            {changes.map((c) => {
              const meta = KIND_META[c.kind]
              const decision = decisions[c.path]
              const open = openPaths[c.path]
              return (
                <div key={c.path} className="rounded bg-black/20">
                  <div className="flex items-center gap-1.5 px-1.5 py-1">
                    <button
                      onClick={() => toggleDiff(c.path)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      {open ? (
                        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className={meta.cls}>{meta.icon}</span>
                      <span className="truncate font-mono text-xs" title={c.path}>
                        {c.path}
                      </span>
                      <span className={`shrink-0 text-[10px] ${meta.cls}`}>{meta.label}</span>
                      {loadingDiff[c.path] && (
                        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                      )}
                    </button>
                    {decision ? (
                      <span
                        className={`shrink-0 text-[10px] ${
                          decision === 'accepted' ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {decision === 'accepted' ? '已保留' : '已回滚'}
                      </span>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => decide(c.path, true)}
                          disabled={busy}
                          title="保留此文件的修改"
                          className="rounded p-0.5 text-green-500 hover:bg-green-500/10 disabled:opacity-40"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => decide(c.path, false)}
                          disabled={busy}
                          title="回滚此文件的修改"
                          className="rounded p-0.5 text-red-500 hover:bg-red-500/10 disabled:opacity-40"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  {open && (
                    <div className="px-1.5 pb-1.5">
                      <DiffViewer raw={diffs[c.path] ?? ''} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 底部操作 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => decideAll(true)}
              disabled={busy || pendingCount === 0}
              className="flex items-center gap-1 rounded bg-green-600/80 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-green-600 disabled:opacity-40"
            >
              <CheckCheck className="h-3 w-3" />
              全部保留
            </button>
            <button
              onClick={() => decideAll(false)}
              disabled={busy || pendingCount === 0}
              className="flex items-center gap-1 rounded bg-red-600/80 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-red-600 disabled:opacity-40"
            >
              <XCircle className="h-3 w-3" />
              全部回滚
            </button>
            {error && <span className="text-[11px] text-red-400">{error}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
