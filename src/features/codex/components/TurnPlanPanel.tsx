import { CheckCircle2, Circle, ListChecks, Loader2 } from 'lucide-react'

import { useCodexStore } from '@/stores/useCodexStore'

/**
 * 模型任务清单面板(数据源:codex `turn/plan/updated`)
 *
 * 这是 codex harness 原生的 todo 机制(等价 Claude Code 的 TodoWrite):
 * 模型自己声明每一步的状态,面板只负责呈现 —— 不做启发式猜测、不做轮询。
 */
export function TurnPlanPanel() {
  const livePlan = useCodexStore((s) => s.livePlan)
  const status = useCodexStore((s) => s.status)

  if (!livePlan || livePlan.steps.length === 0) return null

  const done = livePlan.steps.filter((s) => s.status === 'completed').length
  const total = livePlan.steps.length
  const pct = Math.round((done / total) * 100)
  const allDone = done === total

  return (
    <div className="border-t border-border bg-muted/20 px-3 py-2">
      {/* 头部:进度 */}
      <div className="mb-1.5 flex items-center gap-2 text-xs">
        {allDone ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <ListChecks className="h-3.5 w-3.5 text-primary" />
        )}
        <span className={`font-medium ${allDone ? 'text-green-400' : 'text-primary'}`}>
          {allDone ? '任务已完成' : '任务清单'}
        </span>
        <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
          {done}/{total}
        </span>
        {status === 'running' && !allDone && (
          <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
        )}
      </div>

      {/* 进度条 */}
      <div className="mb-2 h-0.5 overflow-hidden rounded-full bg-primary/10">
        <div
          className={`h-full transition-all duration-500 ease-out ${
            allDone ? 'bg-green-500' : 'bg-primary'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* 步骤列表 */}
      <div className="space-y-0.5">
        {livePlan.steps.map((s, i) => {
          const isDone = s.status === 'completed'
          const isActive = s.status === 'inProgress'
          return (
            <div key={i} className="flex items-start gap-1.5 text-xs">
              <span className="mt-0.5 shrink-0">
                {isDone ? (
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                ) : isActive ? (
                  <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                ) : (
                  <Circle className="h-3 w-3 text-muted-foreground/40" />
                )}
              </span>
              <span
                className={
                  isDone
                    ? 'text-muted-foreground line-through'
                    : isActive
                      ? 'font-medium text-blue-300'
                      : 'text-foreground/80'
                }
              >
                {s.step}
              </span>
            </div>
          )
        })}
      </div>

      {livePlan.explanation && (
        <div className="mt-1.5 border-t border-border/50 pt-1.5 text-[10px] leading-relaxed text-muted-foreground">
          {livePlan.explanation}
        </div>
      )}
    </div>
  )
}
