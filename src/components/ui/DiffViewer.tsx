import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

/** diff 行类型 */
export type DiffLineKind = 'add' | 'del' | 'ctx' | 'hunk' | 'meta'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

/** 解析 unified diff 文本为行数组（与 Git 面板 DiffView 一致） */
export function parseDiff(raw: string): DiffLine[] {
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

const LINE_CLASS: Record<DiffLineKind, string> = {
  add: 'bg-green-500/10 text-green-300',
  del: 'bg-red-500/10 text-red-300',
  ctx: 'text-foreground/85',
  hunk: 'bg-blue-500/10 text-blue-300',
  meta: 'text-muted-foreground/70',
}

/**
 * 纯 diff 渲染组件：输入 unified diff 文本，渲染 GitHub 风格行级高亮。
 * 支持折叠/展开与滚动高度限制。
 */
export function DiffViewer({
  raw,
  maxHeight = 320,
  defaultCollapsed = false,
}: {
  raw: string
  maxHeight?: number
  defaultCollapsed?: boolean
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const lines = parseDiff(raw)
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="flex w-full items-center gap-1.5 px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="h-3 w-3" />
        <span>展开 diff（{lines.length} 行）</span>
      </button>
    )
  }
  return (
    <div className="overflow-hidden rounded bg-black/30">
      <button
        onClick={() => setCollapsed(true)}
        className="flex w-full items-center gap-1.5 border-b border-white/5 px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className="h-3 w-3" />
        <span>收起 diff</span>
      </button>
      <pre className="overflow-auto p-1 font-mono text-[11px] leading-[1.5]" style={{ maxHeight }}>
        {lines.map((l, i) => (
          <div key={i} className={`whitespace-pre ${LINE_CLASS[l.kind]}`}>
            {l.text || ' '}
          </div>
        ))}
      </pre>
    </div>
  )
}
