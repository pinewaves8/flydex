import { AtSign, FileText } from 'lucide-react'

import { useListNavigation } from '@/hooks/useListNavigation'

/**
 * 补全项
 *
 * 两种来源归一成同一形状:
 * - 空查询时 = 本地文件列表(一敲 `@` 就能浏览)—— `indices` 为空
 * - 有查询时 = codex `fuzzyFileSearch` —— 带命中位置,可高亮
 *
 * codex 的模糊搜索对**空查询返回 0 条**(实测),所以"敲下 @ 看什么"必须由本地的
 * 文件列表兜底,不能只靠它。
 */
export interface MentionItem {
  /** 相对 workdir 的路径,如 `src/main.ts` */
  path: string
  /** 命中的字符位置(下标落在 path 上);空数组表示不高亮 */
  indices: number[]
}

interface FileMentionProps {
  /** 当前 input 中的 @query(不含前导 @) */
  query: string
  items: MentionItem[]
  /** 有查询时正在向后端搜索 */
  loading?: boolean
  /** 选中路径(不含前导 @) */
  onSelect: (path: string) => void
  /** 关闭(用户按 Esc 或清空 @ 触发) */
  onClose: () => void
}

/** 按命中位置把路径切成"高亮 / 不高亮"的片段 */
function highlight(path: string, indices: number[]) {
  if (indices.length === 0) return [{ text: path, hit: false }]
  const set = new Set(indices)
  const parts: { text: string; hit: boolean }[] = []
  let buf = ''
  let bufHit = set.has(0)
  // 按**字符**而非字节切:路径里可能有中文,按字节切会切坏
  const chars = Array.from(path)
  chars.forEach((ch, i) => {
    const hit = set.has(i)
    if (hit === bufHit) {
      buf += ch
    } else {
      if (buf) parts.push({ text: buf, hit: bufHit })
      buf = ch
      bufHit = hit
    }
  })
  if (buf) parts.push({ text: buf, hit: bufHit })
  return parts
}

/**
 * @-mention 文件补全面板(对齐 Claude Code)
 *
 * 输入 `@` 触发;键盘 ↑↓ 选择、Enter 确认、Esc 关闭。
 */
export function FileMention({ query, items, loading, onSelect, onClose }: FileMentionProps) {
  const shown = items.slice(0, 12)

  const { highlightIdx, setHighlightIdx, listRef } = useListNavigation({
    items: shown,
    resetKey: query,
    onSelect: (it) => onSelect(it.path),
    onClose,
    enabled: true,
  })

  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-lg overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        <AtSign className="h-3 w-3" />
        <span>{query ? `按名称搜索文件:${query}` : '选择文件(继续输入可模糊搜索)'}</span>
        {loading && <span className="opacity-70">· 搜索中…</span>}
        <span className="ml-auto opacity-70">↑↓ 选择 · Enter 确认 · Esc 关闭</span>
      </div>
      <div ref={listRef} className="max-h-64 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="px-3 py-3 text-center text-xs text-muted-foreground">
            {loading ? '搜索中…' : query ? `没有匹配 “${query}” 的文件` : '没有可用的文件'}
          </div>
        ) : (
          shown.map((it, idx) => {
            const base = it.path.slice(it.path.lastIndexOf('/') + 1)
            const dir = it.path.slice(0, it.path.lastIndexOf('/'))
            return (
              <button
                key={it.path}
                data-idx={idx}
                onClick={() => onSelect(it.path)}
                onMouseEnter={() => setHighlightIdx(idx)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                  idx === highlightIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                }`}
                title={it.path}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {highlight(
                    base,
                    it.indices.map((i) => i - (it.path.length - base.length)),
                  ).map((p, i) => (
                    <span key={i} className={p.hit ? 'font-medium text-primary' : ''}>
                      {p.text}
                    </span>
                  ))}
                </span>
                {dir && (
                  <span className="shrink-0 truncate text-[10px] text-muted-foreground/70">
                    {dir}
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
