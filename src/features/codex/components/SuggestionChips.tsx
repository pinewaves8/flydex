import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSearch,
  RotateCcw,
  Terminal,
  Trash2,
} from 'lucide-react'

import type { TurnStats } from '@/types/codexJson'

export type SuggestionAction =
  | { type: 'review'; label: string }
  | { type: 'rerun'; label: string }
  | { type: 'export'; label: string }
  | { type: 'shell'; label: string; command: string }
  | { type: 'clear'; label: string }
  | { type: 'dismiss'; label: string }

/** 单个建议芯片配置 */
interface Suggestion {
  key: string
  icon: typeof RotateCcw
  label: string
  description?: string
  action: SuggestionAction
  /** 优先级，越小越靠前 */
  priority: number
}

/** 根据本轮统计生成建议列表 */
export function buildSuggestions(stats: TurnStats): Suggestion[] {
  const out: Suggestion[] = []
  // 有文件变更 → 审查
  if (stats.fileChanges > 0) {
    out.push({
      key: 'review',
      icon: FileSearch,
      label: '/review 审查变更',
      description: '结构化审查本次文件改动',
      action: { type: 'review', label: '/review 审查变更' },
      priority: 1,
    })
  }
  // 有工具/MCP 调用 → 导出 Markdown 记录
  if (stats.toolCalls + stats.mcpCalls > 0) {
    out.push({
      key: 'export',
      icon: Download,
      label: '导出 Markdown',
      description: '保存当前会话为可读文档',
      action: { type: 'export', label: '导出 Markdown' },
      priority: 2,
    })
  }
  // 报错 → 查看错误日志
  if (stats.hadErrors) {
    out.push({
      key: 'shell-log',
      icon: Terminal,
      label: '查看运行日志',
      description: '查看完整 stdout/stderr 输出',
      action: {
        type: 'shell',
        label: '查看运行日志',
        command: 'tail -50 logs/flydex-appserver.log',
      },
      priority: 3,
    })
  }
  // 通用：重新运行
  out.push({
    key: 'rerun',
    icon: RotateCcw,
    label: '再跑一次',
    description: '用相同指令再跑一轮',
    action: { type: 'rerun', label: '再跑一次' },
    priority: 4,
  })
  // 通用：清空
  out.push({
    key: 'clear',
    icon: Trash2,
    label: '清空对话',
    description: '开始新的话题',
    action: { type: 'clear', label: '清空对话' },
    priority: 5,
  })
  return out.sort((a, b) => a.priority - b.priority).slice(0, 4)
}

interface SuggestionChipsProps {
  stats: TurnStats
  onAction: (action: SuggestionAction) => void
}

/**
 * SuggestionChips — Claude Code 风格的后续操作建议
 *
 * TurnSummaryCard 下方显示，hover 高亮，点击触发对应 action
 * 由父组件传入 onAction 处理（避免与 codex store 直接耦合）
 */
export function SuggestionChips({ stats, onAction }: SuggestionChipsProps) {
  const suggestions = buildSuggestions(stats)
  return (
    <div className="mb-2 mt-1 flex flex-wrap gap-1.5">
      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <CheckCircle2 className="h-3 w-3" />
        建议后续
      </span>
      {suggestions.map((s) => {
        const Icon = s.icon
        return (
          <button
            key={s.key}
            onClick={() => onAction(s.action)}
            title={s.description}
            className="group flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10"
          >
            <Icon className="h-3 w-3 text-muted-foreground transition-colors group-hover:text-primary" />
            <span>{s.label}</span>
          </button>
        )
      })}
      {/* 折叠按钮：明确告诉用户可以忽略建议 */}
      <button
        onClick={() => onAction({ type: 'dismiss', label: 'dismiss' })}
        title="忽略这些建议"
        className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
      </button>
    </div>
  )
}
