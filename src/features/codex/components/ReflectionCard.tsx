import { Brain, CheckCircle2, Lightbulb, Sparkles } from 'lucide-react'

import { Markdown } from '@/components/ui/Markdown'

interface ReflectionCardProps {
  content: string
  timestamp: number
}

/**
 * ReflectionCard — 自我反思卡片（Phase 1: Self-Reflection）
 *
 * Session 结束时由评价 LLM 自动生成：
 * - 本轮做了什么
 * - 哪里做得好
 * - 哪里可以改进
 * - 给用户的建议
 *
 * 不改任何代码，仅作为参考消息展示。
 */
export function ReflectionCard({ content, timestamp }: ReflectionCardProps) {
  const timeStr = new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-fuchsia-500/5">
      <div className="flex items-center gap-2 border-b border-violet-500/20 px-3 py-2">
        <Brain className="h-4 w-4 text-violet-400" />
        <span className="text-sm font-medium text-foreground">本轮反思</span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          自我评估 · {timeStr}
        </span>
      </div>
      <div className="px-4 py-3">
        {content ? (
          <Markdown content={content} />
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lightbulb className="h-3 w-3" />
            本轮无需反思（纯对话或无活动）
            <CheckCircle2 className="h-3 w-3 text-green-400" />
          </div>
        )}
      </div>
    </div>
  )
}
