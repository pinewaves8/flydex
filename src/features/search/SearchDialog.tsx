import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useListNavigation } from '@/hooks/useListNavigation'
import { threadService } from '@/services/threadService'
import { useProjectStore } from '@/stores/useProjectStore'
import { isInsidePath } from '@/types/thread'
import type { ThreadSearchHit } from '@/types/thread'

interface SearchDialogProps {
  open: boolean
  onClose: () => void
  /** 点击某条结果：打开该会话并定位到命中处 */
  onSelect: (hit: ThreadSearchHit, query: string) => void
}

/** 结果条数上限(codex 侧也会截断) */
const SEARCH_LIMIT = 50

/**
 * 对话搜索(对齐 Claude Code `Ctrl+R`)
 *
 * 数据源是 codex 的 `thread/search`,**粒度是会话**(返回命中的会话 + 片段),
 * 不是消息。定位到具体某条则由 `thread/searchOccurrences` 完成,见 `onSelect`。
 *
 * codex 的这个接口没有 project 参数,所以按当前项目**在前端软过滤** ——
 * 与侧边栏一样,搜索的范围就是当前项目。
 */
export function SearchDialog({ open, onClose, onSelect }: SearchDialogProps) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ThreadSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // 软过滤用:当前项目对应的 codex project id
  const projectMappings = useProjectStore((s) => s.projectMappings)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const codexProjectId = currentProjectId ? (projectMappings[currentProjectId] ?? null) : null
  const projectPath = useProjectStore((s) =>
    currentProjectId ? (s.projects.find((p) => p.id === currentProjectId)?.path ?? null) : null,
  )

  const { highlightIdx, setHighlightIdx, listRef } = useListNavigation({
    items: hits,
    resetKey: query,
    onSelect: (hit) => onSelect(hit, query),
    onClose,
    enabled: open,
  })

  // 打开时自动 focus input
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery('')
      setHits([])
    }
  }, [open])

  // 防抖搜索
  useEffect(() => {
    if (!open) return
    if (!query.trim()) {
      setHits([])
      return
    }
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const results = await threadService.search(query, false, SEARCH_LIMIT)
        // 软过滤(与侧边栏同一口径):归属该项目,或 cwd 落在项目目录树内。
        // 两个依据都没有时不过滤 —— 宁可多给也不要空手。
        const scoped =
          codexProjectId || projectPath
            ? results.filter(
                (h) =>
                  (codexProjectId && h.projectId === codexProjectId) ||
                  (projectPath && isInsidePath(h.cwd, projectPath)),
              )
            : results
        setHits(scoped)
      } catch {
        setHits([])
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [query, open, codexProjectId, projectPath])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-20"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部搜索框 */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索当前项目的对话内容…(Ctrl+R)"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Esc
          </kbd>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 搜索结果(粒度是会话,点进去再定位到具体命中) */}
        <div ref={listRef} className="max-h-96 overflow-y-auto">
          {!query.trim() ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              输入关键词搜索当前项目的对话
            </div>
          ) : loading && hits.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">搜索中…</div>
          ) : hits.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              没有匹配 “{query}” 的会话
            </div>
          ) : (
            hits.map((hit, idx) => (
              <button
                key={hit.threadId}
                data-idx={idx}
                onClick={() => onSelect(hit, query)}
                onMouseEnter={() => setHighlightIdx(idx)}
                className={`flex w-full flex-col gap-1 border-b border-border/40 px-4 py-2 text-left transition-colors ${
                  idx === highlightIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                }`}
              >
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="max-w-[60%] truncate font-medium">{hit.title}</span>
                  {hit.archived && (
                    <span className="rounded bg-destructive/20 px-1 py-0.5 text-destructive">
                      回收站
                    </span>
                  )}
                  <span className="ml-auto">
                    {new Date(hit.updatedAt).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="line-clamp-2 text-xs">{hit.snippet}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
