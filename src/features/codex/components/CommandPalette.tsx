import { ChevronRight, Hash } from 'lucide-react'

import { useListNavigation } from '@/hooks/useListNavigation'

/** 命令定义(对齐 Claude Code `/` 命令面板风格) */
export interface CommandItem {
  /** 命令名,不含前导 `/` */
  name: string
  /** 一句话描述 */
  description: string
  /** 可选分类(如 init / skill / session) */
  category?: string
}

export const COMMANDS: CommandItem[] = [
  // 项目初始化(顶级命令,init 流程的子命令由 AI 自动调用,不展示给用户)
  {
    name: 'init',
    description: '扫描项目,AI 自主生成 AGENTS.md(对齐 Claude Code /init)',
    category: 'init',
  },
  // 内置技能(skills)
  { name: 'review', description: '对当前代码变更进行结构化审查', category: 'skill' },
  { name: 'plan', description: '进入计划模式:先生成可编辑计划再执行', category: 'skill' },
  { name: 'web-search', description: '联网搜索(基于 MCP web_search)', category: 'skill' },
  // 会话控制
  { name: 'new', description: '开始新会话(清空当前 thread)', category: 'session' },
  { name: 'clear', description: '清空当前会话输出', category: 'session' },
  { name: 'compact', description: '压缩上下文(长会话摘要)', category: 'session' },
  // 元
  { name: 'help', description: '显示可用命令和帮助', category: 'meta' },
]

interface CommandPaletteProps {
  /** 当前 input 值(如 `/re` —— 包括前导 `/` 和后续字母) */
  query: string
  /** 选中命令后触发(命令名不含前导 /) */
  onSelect: (cmdName: string) => void
  /** 关闭面板(用户按 Esc 或失焦) */
  onClose: () => void
}

/**
 * `/` 命令面板(对齐 Claude Code 风格)
 *
 * 实现细节:
 * - 在 useEffect 里挂 window keydown 监听(而非依赖 React 事件冒泡)
 * - textarea 的 onKeyDown 不用管 ↑↓ Enter Escape
 * - palette 只在挂载期间拦截键盘,卸载后恢复默认行为
 */
export function CommandPalette({ query, onSelect, onClose }: CommandPaletteProps) {
  // 提取 query(去掉前导 /)
  const filterText = query.startsWith('/') ? query.slice(1) : query

  // 过滤命令:名称以 filterText 开头(忽略大小写)
  const filtered = COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(filterText.toLowerCase()),
  )

  const { highlightIdx, setHighlightIdx, listRef } = useListNavigation({
    items: filtered,
    resetKey: filterText,
    onSelect: (cmd) => onSelect(cmd.name),
    onClose,
  })

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-0 z-10 mb-1 w-full rounded-md border border-border bg-background/95 p-2 text-xs text-muted-foreground shadow-2xl backdrop-blur-sm">
        没有匹配的命令
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 z-10 mb-1 max-h-80 w-full overflow-y-auto rounded-md border border-border bg-background/95 shadow-2xl backdrop-blur-sm"
      role="listbox"
    >
      {filtered.map((cmd, idx) => (
        <button
          key={cmd.name}
          data-idx={idx}
          onClick={() => onSelect(cmd.name)}
          onMouseEnter={() => setHighlightIdx(idx)}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
            idx === highlightIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
          }`}
          role="option"
          aria-selected={idx === highlightIdx}
        >
          <Hash className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="font-mono">/{cmd.name}</span>
          {cmd.category && (
            <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
              {cmd.category}
            </span>
          )}
          <span className="flex-1 truncate text-muted-foreground">{cmd.description}</span>
          {idx === highlightIdx && <ChevronRight className="h-3 w-3 shrink-0" />}
        </button>
      ))}
    </div>
  )
}
