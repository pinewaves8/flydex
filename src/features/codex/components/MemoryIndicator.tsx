import { BookOpen, Database, Minimize2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { memoryService } from '@/services/memoryService'
import { useCodexStore } from '@/stores/useCodexStore'

/**
 * 上下文与记忆指示器（6.1）
 *
 * - 记忆层徽章：L1 用户记忆（~/.flydex/MEMORY.md） / L2 项目记忆（.flydex/MEMORY.md）
 *   是否生效（存在内容即点亮，否则置灰）
 * - 上下文用量条：基于当前会话消息 JSON 长度的 token 粗估，展示进度条与千 token 数；
 *   超过 80% 预算时显示「压缩」按钮（需提供 onCompact 回调）
 */
export function MemoryIndicator({
  workdir,
  onCompact,
}: {
  workdir: string
  onCompact?: () => void
}) {
  const messages = useCodexStore((s) => s.messages)
  const [userLen, setUserLen] = useState(0)
  const [projectLen, setProjectLen] = useState(0)

  useEffect(() => {
    let cancelled = false
    memoryService
      .load(workdir || null)
      .then((d) => {
        if (cancelled) return
        setUserLen(d.user.trim().length)
        setProjectLen(d.project.trim().length)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [workdir])

  // 上下文粗估：消息 JSON 字符数 / 4 ≈ token；预算按 128k 计（近似，仅作指示）
  const estTokens = Math.round(messages.reduce((acc, m) => acc + JSON.stringify(m).length, 0) / 4)
  const budget = 128000
  const pct = Math.min(100, Math.round((estTokens / budget) * 100))

  return (
    <div className="flex items-center gap-1.5" title="上下文与记忆（L1 用户 / L2 项目 / 会话用量）">
      <span
        className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
          userLen > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
        }`}
        title={userLen > 0 ? `用户记忆已生效（${userLen} 字符）` : '用户记忆未设置'}
      >
        <Database className="h-3 w-3" />
        L1 {userLen > 0 ? '✓' : '–'}
      </span>
      <span
        className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
          projectLen > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
        }`}
        title={projectLen > 0 ? `项目记忆已生效（${projectLen} 字符）` : '项目记忆未设置'}
      >
        <BookOpen className="h-3 w-3" />
        L2 {projectLen > 0 ? '✓' : '–'}
      </span>
      <span
        className="flex items-center gap-1 text-[10px] text-muted-foreground"
        title={`会话上下文约 ${estTokens.toLocaleString()} tokens（粗估，预算 ${(budget / 1000).toFixed(0)}k）`}
      >
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
          <span
            className={`block h-full rounded-full ${pct > 80 ? 'bg-yellow-500' : 'bg-primary/60'}`}
            style={{ width: `${pct}%` }}
          />
        </span>
        {Math.round(estTokens / 1000)}k
      </span>
      {pct > 80 && onCompact && (
        <button
          onClick={onCompact}
          className="flex items-center gap-0.5 rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-500 hover:bg-yellow-500/25"
          title="会话上下文接近预算:由 codex 压缩上下文(历史会被替换成一段摘要,旧轮次从界面上消失;工作区文件改动不受影响)"
        >
          <Minimize2 className="h-3 w-3" />
          压缩
        </button>
      )}
    </div>
  )
}
