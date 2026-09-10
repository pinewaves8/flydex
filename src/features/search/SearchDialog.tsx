import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useListNavigation } from '@/hooks/useListNavigation'
import { sessionService, type MessageSearchHit } from '@/services/sessionService'

interface SearchDialogProps {
  open: boolean
  onClose: () => void
  /** 当前项目 ID(用于过滤范围);null = 全部项目 */
  projectId: string | null
  /** 点击搜索结果 */
  onSelect: (hit: MessageSearchHit) => void
}

/**
 * 对话全文搜索(对齐 Claude Code `Ctrl+R`)
 *
 * - 上箭头/下箭头:选择结果
 * - Enter:打开选中结果(切到该会话并定位消息)
 * - Esc:关闭
 */
export function SearchDialog({ open, onClose, projectId, onSelect }: SearchDialogProps) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<MessageSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { highlightIdx, setHighlightIdx, listRef } = useListNavigation({
    items: hits,
    resetKey: query,
    onSelect: (hit) => onSelect(hit),
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

  // 防抖搜索(query 变化时触发)
  useEffect(() => {
    if (!open) return
    if (!query.trim()) {
      setHits([])
      return
    }
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const results = await sessionService.searchMessages(query, projectId, 50)
        setHits(results)
      } catch {
        setHits([])
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [query, open, projectId])

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
            placeholder="搜索所有对话的内容...(对齐 Ctrl+R)"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Esc
          </kbd>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 搜索结果 */}
        <div ref={listRef} className="max-h-96 overflow-y-auto">
          {!query.trim() ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              输入关键词搜索所有会话(标题 + 消息内容)
            </div>
          ) : loading && hits.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">搜索中…</div>
          ) : hits.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              没有匹配 "{query}" 的结果
            </div>
          ) : (
            hits.map((hit, idx) => (
              <button
                key={`${hit.session_id}:${hit.message_id}`}
                data-idx={idx}
                onClick={() => onSelect(hit)}
                onMouseEnter={() => setHighlightIdx(idx)}
                className={`flex w-full flex-col gap-1 border-b border-border/40 px-4 py-2 text-left transition-colors ${
                  idx === highlightIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                }`}
              >
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="font-medium">{hit.session_title}</span>
                  <span className="rounded bg-muted px-1 py-0.5">{hit.message_kind}</span>
                  <span className="ml-auto">
                    {new Date(hit.timestamp).toLocaleString('zh-CN', {
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
