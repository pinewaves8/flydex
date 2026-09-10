import { AtSign, FileText } from 'lucide-react'

import { useListNavigation } from '@/hooks/useListNavigation'

interface FileMentionProps {
  /** 当前 input 中的 @query(不含前导 @) */
  query: string
  /** 文件列表(相对 workdir 路径,如 `src/main.ts`) */
  files: string[]
  /** 选中文件名(不含前导 @) */
  onSelect: (filename: string) => void
  /** 关闭(用户按 Esc 或清空 @ 触发) */
  onClose: () => void
}

/**
 * @-mention 文件补全面板(对齐 Claude Code)
 *
 * 输入 `@` 触发,实时按子串模糊匹配文件名
 * - ↑↓ / Enter / Esc 键盘操作
 * - 鼠标悬停可选中
 * - 列表为空时显示提示
 */
export function FileMention({ query, files, onSelect, onClose }: FileMentionProps) {
  // 模糊匹配:路径含 query(忽略大小写)。basename 命中优先 ——
  // 用户敲 "@App" 时希望先看到 src/App.tsx,而不是 dir/foo/App.txt。
  const lowerQ = query.toLowerCase()
  const basenameHit: string[] = []
  const pathHit: string[] = []
  for (const f of files) {
    if (!f.toLowerCase().includes(lowerQ)) continue
    const base = f.slice(f.lastIndexOf('/') + 1).toLowerCase()
    ;(base.includes(lowerQ) ? basenameHit : pathHit).push(f)
  }
  const filtered = [...basenameHit, ...pathHit].slice(0, 12)

  const { highlightIdx, setHighlightIdx, listRef } = useListNavigation({
    items: filtered,
    resetKey: query,
    onSelect: (file) => onSelect(file),
    onClose,
  })

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-0 z-10 mb-1 w-full rounded-md border border-border bg-background/95 p-2 text-xs text-muted-foreground shadow-2xl backdrop-blur-sm">
        {query ? `没有匹配 "${query}" 的文件` : '输入文件名片段筛选,Enter 选中'}
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 z-10 mb-1 max-h-80 w-full overflow-y-auto rounded-md border border-border bg-background/95 shadow-2xl backdrop-blur-sm"
      role="listbox"
    >
      {filtered.map((file, idx) => {
        const basename = file.split('/').pop() ?? file
        const dir = file.slice(0, file.length - basename.length)
        return (
          <button
            key={file}
            data-idx={idx}
            onClick={() => onSelect(file)}
            onMouseEnter={() => setHighlightIdx(idx)}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
              idx === highlightIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
            }`}
            role="option"
            aria-selected={idx === highlightIdx}
          >
            {idx === highlightIdx ? (
              <AtSign className="h-3 w-3 shrink-0 text-primary" />
            ) : (
              <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <span className="shrink-0 font-mono">@{basename}</span>
            {dir && (
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                {dir}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
