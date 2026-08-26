import { useEffect, useState } from 'react'

import { gitService } from '@/services/gitService'
import type { FileChange } from '@/types/git'

/** diff 行类型 */
type DiffLineKind = 'add' | 'del' | 'ctx' | 'hunk' | 'meta'

interface DiffLine {
  kind: DiffLineKind
  text: string
}

/** 解析 unified diff 文本为行数组 */
function parseDiff(raw: string): DiffLine[] {
  const lines: DiffLine[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('@@')) {
      lines.push({ kind: 'hunk', text: line })
    } else if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++')
    ) {
      lines.push({ kind: 'meta', text: line })
    } else if (line.startsWith('+')) {
      lines.push({ kind: 'add', text: line.slice(1) })
    } else if (line.startsWith('-')) {
      lines.push({ kind: 'del', text: line.slice(1) })
    } else {
      lines.push({ kind: 'ctx', text: line })
    }
  }
  return lines
}

/** 收集所有 hunk 头行（用于定位 hunk 索引） */
function collectHunkHeaders(raw: string): string[] {
  const headers: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('@@')) headers.push(line)
  }
  return headers
}

export function DiffView({
  repo,
  change,
  onMutated,
}: {
  repo: string
  change: FileChange
  onMutated: () => void
}) {
  const [raw, setRaw] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [mode, setMode] = useState<'unstaged' | 'staged'>(
    change.staged && !change.unstaged ? 'staged' : 'unstaged',
  )

  // 加载 diff（切换文件或模式时）
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const load = async () => {
      try {
        const text =
          mode === 'staged'
            ? await gitService.diffCached(repo, change.path)
            : await gitService.diff(repo, change.path)
        if (!cancelled) setRaw(text)
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [repo, change.path, mode])

  const hunkHeaders = raw ? collectHunkHeaders(raw) : []

  // hunk 暂存/取消
  const handleHunkAction = async (hunkHeader: string, action: 'stage' | 'unstage') => {
    if (!raw) return
    setBusy(hunkHeader)
    setError(null)
    try {
      const hunkIdx = hunkHeaders.indexOf(hunkHeader)
      if (hunkIdx < 0) {
        setError('无法定位 hunk')
        return
      }
      if (action === 'stage') {
        await gitService.stageHunk(repo, change.path, hunkIdx)
      } else {
        await gitService.unstageHunk(repo, change.path, hunkIdx)
      }
      // 重新加载当前模式 diff + 通知上层刷新状态
      const text =
        mode === 'staged'
          ? await gitService.diffCached(repo, change.path)
          : await gitService.diff(repo, change.path)
      setRaw(text)
      onMutated()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(null)
    }
  }

  const lines = raw ? parseDiff(raw) : []

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* diff 头部：文件名 + 模式切换 */}
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium" title={change.path}>
            {change.path}
          </span>
          <span className="shrink-0 text-[10px] text-green-600">+{change.insertions}</span>
          <span className="shrink-0 text-[10px] text-red-600">-{change.deletions}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {change.unstaged && (
            <button
              onClick={() => {
                setMode('unstaged')
                setRaw(null)
              }}
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                mode === 'unstaged'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'
              }`}
            >
              未暂存
            </button>
          )}
          {change.staged && (
            <button
              onClick={() => {
                setMode('staged')
                setRaw(null)
              }}
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                mode === 'staged'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'
              }`}
            >
              已暂存
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* diff 内容 */}
      <div className="flex-1 overflow-auto font-mono text-xs leading-5">
        {loading && <div className="px-3 py-2 text-muted-foreground">加载中…</div>}
        {!loading && raw === '' && <div className="px-3 py-2 text-muted-foreground">无差异</div>}
        {!loading && raw && (
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, i) => {
                if (line.kind === 'meta') {
                  return (
                    <tr key={i}>
                      <td className="w-8 border-r border-border bg-muted/50 px-2 text-right text-muted-foreground/50" />
                      <td className="w-8 border-r border-border bg-muted/50 px-2 text-right text-muted-foreground/50" />
                      <td className="bg-muted/30 px-2 text-muted-foreground/60">{line.text}</td>
                    </tr>
                  )
                }
                if (line.kind === 'hunk') {
                  const canStage = mode === 'unstaged' && change.unstaged
                  const canUnstage = mode === 'staged' && change.staged
                  return (
                    <tr key={i}>
                      <td className="w-8 border-r border-border bg-muted/50 px-2 text-right text-muted-foreground/50" />
                      <td className="w-8 border-r border-border bg-muted/50 px-2 text-right text-muted-foreground/50" />
                      <td className="bg-muted/50 px-2 py-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground/60">{line.text}</span>
                          {busy === line.text ? (
                            <span className="text-[10px] text-muted-foreground">处理中…</span>
                          ) : (
                            <>
                              {canStage && (
                                <button
                                  onClick={() => handleHunkAction(line.text, 'stage')}
                                  className="rounded bg-green-600/20 px-1.5 py-0.5 text-[10px] text-green-600 transition-colors hover:bg-green-600/30"
                                  title="暂存此 hunk"
                                >
                                  +
                                </button>
                              )}
                              {canUnstage && (
                                <button
                                  onClick={() => handleHunkAction(line.text, 'unstage')}
                                  className="rounded bg-yellow-600/20 px-1.5 py-0.5 text-[10px] text-yellow-600 transition-colors hover:bg-yellow-600/30"
                                  title="取消暂存此 hunk"
                                >
                                  -
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                }
                const bg =
                  line.kind === 'add'
                    ? 'bg-green-600/10'
                    : line.kind === 'del'
                      ? 'bg-red-600/10'
                      : 'transparent'
                const fg =
                  line.kind === 'add'
                    ? 'text-green-400'
                    : line.kind === 'del'
                      ? 'text-red-400'
                      : 'text-foreground/80'
                return (
                  <tr key={i} className={bg}>
                    <td className="w-8 border-r border-border px-2 text-right text-muted-foreground/50">
                      {line.kind === 'del' || line.kind === 'ctx' ? ' ' : ''}
                    </td>
                    <td className="w-8 border-r border-border px-2 text-right text-muted-foreground/50">
                      {line.kind === 'add' || line.kind === 'ctx' ? ' ' : ''}
                    </td>
                    <td className={`whitespace-pre px-2 ${fg}`}>{line.text || ' '}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
