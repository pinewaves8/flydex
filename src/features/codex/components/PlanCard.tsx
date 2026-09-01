import { Check, ListChecks, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import type { CodexMessage } from '@/types/codexJson'

/** 解析计划文本 → 步骤数组
 *
 * 只识别**顶层编号步骤**（如 `1.` / `1)` / `1、`），忽略：
 * - markdown 分隔线（`---`、`***`、`===`）
 * - 加粗子标题 / 子列表详情（`**目标**`、缩进的 `- **涉及文件**` 等）
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
    if (num) {
      steps.push(num[1])
      continue
    }
    // 无编号步骤时的普通列表项兜底（仅当还没有任何步骤）
    if (steps.length === 0) {
      const dash = line.match(/^[-*•]\s*(.+)/)
      if (dash) steps.push(dash[1])
    }
    // 其余行（子项说明、加粗标题等）忽略
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

  return (
    <div className="rounded border border-primary/30 bg-primary/5 py-2 pl-3 pr-2">
      {/* 头部 */}
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-primary">
        <ListChecks className="h-3.5 w-3.5" />
        <span className="font-medium">Plan · 分步计划</span>
        <span className="ml-auto text-[10px] opacity-50">{timeStr}</span>
      </div>

      {/* 步骤列表 */}
      <div className="space-y-1">
        {steps.map((step, idx) => (
          <div key={idx} className="group flex items-start gap-2">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-medium text-primary">
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
                <div className="flex-1 whitespace-pre-wrap text-sm text-foreground">{step}</div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => startEdit(idx)}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    title="编辑步骤"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => removeStep(idx)}
                    className="rounded p-1 text-muted-foreground hover:bg-red-500/15 hover:text-red-400"
                    title="删除步骤"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
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
          className="mt-1.5 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Plus className="h-2.5 w-2.5" /> 添加步骤
        </button>
      )}

      {/* 操作 */}
      <div className="mt-2 flex items-center gap-2 border-t border-border/50 pt-2">
        <button
          onClick={() => onApprove(steps)}
          disabled={disabled || steps.length === 0}
          className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-3 w-3" />
          批准并执行
        </button>
        <button
          onClick={onCancel}
          disabled={disabled}
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          <X className="h-3 w-3" />
          取消计划
        </button>
        {disabled && <span className="text-[10px] text-muted-foreground/70">执行中…</span>}
      </div>
    </div>
  )
}
