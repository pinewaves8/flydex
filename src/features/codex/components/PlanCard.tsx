import { Check, ListChecks, Loader2, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { taskService } from '@/services/taskService'
import { useProjectStore } from '@/stores/useProjectStore'
import type { CodexMessage } from '@/types/codexJson'
import type { Task } from '@/types/task'

/** 解析计划文本 → 步骤数组
 *
 * 只识别**顶层编号步骤**（如 `1.` / `1)` / `1、`），忽略：
 * - markdown 分隔线（`---`、`***`、`===`）
 * - 加粗子标题 / 子列表详情（缩进的 `- **涉及文件**` 等）
 * 清理 markdown 标记与"目标:"标签前缀，过滤纯标题等无意义步骤。
 * 无编号结构时整段作为一步兜底。
 */
export function parsePlanSteps(content: string): string[] {
  const lines = content
    .split('\n')
    .map((l) => l.replace(/\r$/, '').trim())
    .filter(Boolean)
  const steps: string[] = []
  for (const line of lines) {
    // 忽略 markdown 分隔线
    if (/^[-*_=]{3,}$/.test(line)) continue
    // 顶层编号步骤
    const num = line.match(/^\d+[.、)]\s*(.+)/)
    let stepText: string | null = null
    if (num) {
      stepText = num[1]
    } else if (steps.length === 0) {
      // 无编号步骤时的普通列表项兜底（仅当还没有任何步骤）
      const dash = line.match(/^[-*•]\s*(.+)/)
      if (dash) stepText = dash[1]
    }
    if (stepText == null) continue
    // 清理 markdown 标记
    let t = stepText.replace(/\*\*/g, '').trim()
    // 去掉 "目标" / "目标:" 标签前缀（模型可能用扁平"目标:"格式）
    t = t.replace(/^目标\s*[:：]\s*/, '')
    // 过滤无意义步骤（空、过短、纯标题词）
    if (!t || t.length < 2) continue
    if (/^(执行计划|计划总结|前言|概述|开始执行|步骤)$/.test(t)) continue
    steps.push(t)
  }
  return steps.length > 0 ? steps : [content]
}

interface PlanCardProps {
  message: CodexMessage
  onApprove: (steps: string[]) => void
  onCancel: () => void
  disabled?: boolean
}

export function PlanCard({ message, onApprove, onCancel, disabled }: PlanCardProps) {
  const [steps, setSteps] = useState<string[]>(() => parsePlanSteps(message.content))
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState('')
  // 点击批准后永久标记已执行，防止执行期间/结束后重复批准同一计划
  const [approved, setApproved] = useState(false)
  // Claude Code 风格：plan 卡片显示后倒计时 5 秒自动执行(用户可立即执行或取消)
  const [countdown, setCountdown] = useState(5)
  // 用户取消倒计时后,不再自动执行
  const [cancelled, setCancelled] = useState(false)
  const projectId = useProjectStore((s) => s.currentProjectId)
  const sessionId = useProjectStore((s) => s.currentSessionId)

  // 倒计时自动执行(对齐 Claude Code 默认行为):5 秒后自动批准。
  // 用户可点「立即执行」跳过,或点「取消」中止。
  useEffect(() => {
    if (approved || cancelled) return
    if (countdown <= 0) {
      void handleApprove()
      return
    }
    const t = setTimeout(() => setCountdown((n) => n - 1), 1000)
    return () => clearTimeout(t)
    // handleApprove 每次渲染都是新引用,故意不列入依赖以免重置计时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, approved, cancelled])

  const timeStr = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const startEdit = (idx: number) => {
    setEditing(idx)
    setDraft(steps[idx])
  }

  const saveEdit = () => {
    if (editing == null) return
    const next = [...steps]
    next[editing] = draft.trim()
    setSteps(next.filter((s) => s.length > 0))
    setEditing(null)
    setDraft('')
  }

  const removeStep = (idx: number) => {
    setSteps(steps.filter((_, i) => i !== idx))
    setEditing(null)
  }

  const addStep = () => {
    const t = addDraft.trim()
    if (!t) return
    setSteps([...steps, t])
    setAddDraft('')
    setAdding(false)
  }

  /** 批准并执行:批量创建 task(关联到当前会话,便于在「任务」面板持续跟踪) */
  const handleApprove = async () => {
    if (approved) return
    if (steps.length === 0) return
    setApproved(true)
    const createdIds: (string | null)[] = []
    for (const step of steps) {
      try {
        const t: Task = await taskService.create({
          title: step,
          description: '',
          priority: 'medium',
          projectId,
          sessionId,
        })
        createdIds.push(t.id)
      } catch {
        createdIds.push(null)
      }
    }
    onApprove(steps)
  }

  const totalCount = steps.length

  return (
    <div className="rounded border border-primary/30 bg-primary/5 py-2 pl-3 pr-2">
      {/* 头部(进度由 TurnPlanPanel 依据 codex turn/plan/updated 呈现,此处只做计划本身) */}
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-primary">
        <ListChecks className="h-3.5 w-3.5" />
        <span className="font-medium">Plan · 分步计划</span>
        <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px]">
          {totalCount} 步
        </span>
        {/* Claude Code 风格:5 秒倒计时自动执行 */}
        {!approved && !cancelled && totalCount > 0 && (
          <span className="ml-1 flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            {countdown}s 后自动执行
          </span>
        )}
        {cancelled && !approved && totalCount > 0 && (
          <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            已取消
          </span>
        )}
        <span className="ml-auto text-[10px] opacity-50">{timeStr}</span>
      </div>

      {/* 步骤列表 */}
      <div className="space-y-1">
        {steps.map((step, idx) => {
          return (
            <div key={idx} className="group flex items-start gap-2 rounded px-1.5 py-1">
              {/* 序号(执行进度由 TurnPlanPanel 展示) */}
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] text-primary">
                {idx + 1}
              </span>
              {editing === idx ? (
                <div className="flex-1">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={2}
                    autoFocus
                    className="w-full resize-none rounded border border-primary/40 bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="mt-1 flex gap-1.5">
                    <button
                      onClick={saveEdit}
                      className="flex items-center gap-0.5 rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground hover:bg-primary/90"
                    >
                      <Check className="h-2.5 w-2.5" /> 保存
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
                    >
                      <X className="h-2.5 w-2.5" /> 取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                    <span className="whitespace-pre-wrap text-sm text-foreground">{step}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => startEdit(idx)}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      title="编辑步骤"
                      disabled={approved}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => void removeStep(idx)}
                      className="rounded p-1 text-muted-foreground hover:bg-red-500/15 hover:text-red-400"
                      title="删除步骤"
                      disabled={approved}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* 添加步骤 */}
      {adding ? (
        <div className="mt-1.5">
          <textarea
            value={addDraft}
            onChange={(e) => setAddDraft(e.target.value)}
            rows={2}
            autoFocus
            placeholder="新步骤内容…"
            className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="mt-1 flex gap-1.5">
            <button
              onClick={addStep}
              className="flex items-center gap-0.5 rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-2.5 w-2.5" /> 添加
            </button>
            <button
              onClick={() => setAdding(false)}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
            >
              <X className="h-2.5 w-2.5" /> 取消
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={approved}
          className="mt-1.5 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          <Plus className="h-2.5 w-2.5" /> 添加步骤
        </button>
      )}

      {/* 操作 —— Claude Code 风格:默认倒计时自动执行,用户可立即执行或取消 */}
      <div className="mt-2 flex items-center gap-2 border-t border-border/50 pt-2">
        <button
          onClick={() => void handleApprove()}
          disabled={disabled || approved || cancelled || steps.length === 0}
          className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-3 w-3" />
          {approved ? '已提交执行' : cancelled ? '已取消' : `立即执行 (${countdown}s)`}
        </button>
        {!cancelled && !approved && (
          <button
            onClick={() => {
              setCancelled(true)
              onCancel()
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" />
            取消
          </button>
        )}
        {approved && <span className="text-[10px] text-primary/70">✓ 已提交执行</span>}
        {!approved && disabled && (
          <span className="text-[10px] text-muted-foreground/70">执行中…</span>
        )}
      </div>
    </div>
  )
}
