import { GitCommitHorizontal, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { gitService } from '@/services/gitService'
import type { GitCommit } from '@/types/git'

/** 相对时间 */
function relativeTime(ts: number): string {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}天前`
  return new Date(ts * 1000).toLocaleDateString('zh-CN')
}

/** 简单渲染 git show 输出（着色 +/- 行） */
function ShowDiff({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <pre className="font-mono text-xs leading-5">
      {lines.map((line, i) => {
        let cls = 'text-foreground/80'
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'bg-green-600/10 text-green-400'
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'bg-red-600/10 text-red-400'
        else if (line.startsWith('@@')) cls = 'text-cyan-500'
        else if (
          line.startsWith('commit ') ||
          line.startsWith('Author:') ||
          line.startsWith('Date:')
        )
          cls = 'font-semibold text-foreground'
        return (
          <div key={i} className={`whitespace-pre ${cls}`}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

export function HistoryView({ repo }: { repo: string }) {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [show, setShow] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await gitService.log(repo, 50)
      setCommits(list)
    } catch (e) {
      setError(String(e))
      setCommits([])
    } finally {
      setLoading(false)
    }
  }, [repo])

  useEffect(() => {
    void load()
  }, [load])

  // 选择提交时加载详情
  useEffect(() => {
    if (!selected) {
      setShow(null)
      return
    }
    let cancelled = false
    setShow(null)
    gitService
      .show(repo, selected)
      .then((text) => {
        if (!cancelled) setShow(text)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [repo, selected])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">提交历史</span>
        <button
          onClick={() => void load()}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="刷新"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* 提交列表 */}
        <div className="w-72 shrink-0 overflow-y-auto border-r border-border">
          {commits.length === 0 && !loading && (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">暂无提交</div>
          )}
          {commits.map((c) => {
            const active = selected === c.hash
            return (
              <button
                key={c.hash}
                onClick={() => setSelected(active ? null : c.hash)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors ${
                  active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                }`}
              >
                <GitCommitHorizontal
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${active ? '' : 'text-muted-foreground'}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{c.summary}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="font-mono">{c.short_hash}</span>
                    <span className="truncate">{c.author}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground/60">
                    {relativeTime(c.timestamp)}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* 提交详情 */}
        <div className="flex-1 overflow-auto p-2">
          {!selected && (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              选择提交查看详情
            </div>
          )}
          {selected && !show && (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              加载中…
            </div>
          )}
          {show && <ShowDiff content={show} />}
        </div>
      </div>
    </div>
  )
}
