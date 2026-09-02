import { Clock, Sparkles } from 'lucide-react'

import { Markdown } from '@/components/ui/Markdown'
import { useSkillsStore } from '@/stores/useSkillsStore'
import type { CodexMessage } from '@/types/codexJson'

/**
 * SkillCard — 技能执行结果卡片
 *
 * 当技能执行完成时，在对话流中显示结构化结果。
 * 类似 PlanCard 和 ReviewCard 的模式。
 */
export function SkillCard({ message }: { message: CodexMessage }) {
  const skills = useSkillsStore((s) => s.skills)

  // 从消息内容中提取技能名（格式：「技能:xxx」）
  const skillName = message.content.match(/【技能:(\S+?)】/)?.[1]
  const skill = skillName ? skills.find((s) => s.name === skillName) : undefined

  const timeStr = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5">
      <div className="flex items-center gap-2 border-b border-primary/10 px-3 py-2">
        <Sparkles
          className="h-4 w-4"
          style={{ color: skill?.interface?.brandColor ?? 'var(--primary)' }}
        />
        <span className="text-sm font-medium text-foreground">
          {skill?.interface?.displayName ?? skillName ?? '技能'}
        </span>
        <span className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground">
          <Clock className="h-2.5 w-2.5" />
          {timeStr}
        </span>
      </div>
      <div className="px-3 py-2">
        <Markdown content={message.content} />
      </div>
    </div>
  )
}
