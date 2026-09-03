import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  Plus,
  ShieldAlert,
  Square,
  Trash2,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { runCodex, stopCodex } from '@/services/codex'
import type { CodexEvent } from '@/types/codex'

/**
 * 子代理并行面板（6.3 P1）
 *
 * 基于方案 A：每个子代理是一个独立 codex exec 子进程（不同 run_id + 可独立 workdir），
 * 并行执行。事件经 codex-output/codex-done 按 run_id 路由回各自任务卡片。
 * 主会话（useCodexSession）按 run_id 过滤，互不污染。
 */
export interface SubAgentTask {
  id: string
  name: string
  instruction: string
  workdir: string
  /** 权限隔离：inherit=继承全局沙箱；read-only=强制只读 */
  sandbox: 'inherit' | 'read-only'
  runId: string | null
  status: 'pending' | 'running' | 'done' | 'error' | 'stopped'
  exitCode: number | null
  lines: { kind: 'stdout' | 'stderr' | 'system'; text: string }[]
  lastAgent: string
  startedAt?: number
  endedAt?: number
}

let taskSeq = 0
const newTask = (workdir: string): SubAgentTask => ({
  id: `sub_${Date.now()}_${taskSeq++}`,
  name: `子任务 ${taskSeq}`,
  instruction: '',
  workdir,
  sandbox: 'inherit',
  runId: null,
  status: 'pending',
  exitCode: null,
  lines: [],
  lastAgent: '',
})

interface SubagentPanelProps {
  open: boolean
  onClose: () => void
  defaultWorkdir: string
  defaultModel: string | null
}

export function SubagentPanel({ open, onClose, defaultWorkdir, defaultModel }: SubagentPanelProps) {
  const [tasks, setTasks] = useState<SubAgentTask[]>(() => [newTask(defaultWorkdir)])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  // 事件路由：按 run_id 分发到对应任务（面板常驻监听，open 控制显隐）
  useEffect(() => {
    let unOut: UnlistenFn | null = null
    let unDone: UnlistenFn | null = null
    let cancelled = false
    const init = async () => {
      unOut = await listen<CodexEvent>('codex-output', (ev) => {
        const p = ev.payload
        setTasks((prev) => {
          const t = prev.find((x) => x.runId && x.runId === p.run_id)
          if (!t) return prev
          if (p.type === 'Json') {
            const j = p.data as {
              type?: string
              message?: string
              item?: { type?: string; text?: unknown }
            }
            if (j?.type === 'error' && j.message) {
              // 模型 API 错误/重连提示显示到该子代理输出
              return prev.map((x) =>
                x.id === t.id
                  ? {
                      ...x,
                      lines: [...x.lines, { kind: 'stderr' as const, text: `⚠️ ${j.message}` }],
                    }
                  : x,
              )
            }
            if (j?.type === 'item.completed' && j.item?.type === 'agent_message') {
              // 记录最后一条 agent 消息作为"结论摘要"
              return prev.map((x) =>
                x.id === t.id ? { ...x, lastAgent: String(j.item?.text ?? '').trim() } : x,
              )
            }
            return prev
          }
          if (p.type === 'Output') {
            return prev.map((x) =>
              x.id === t.id
                ? { ...x, lines: [...x.lines, { kind: 'stdout' as const, text: p.data.text }] }
                : x,
            )
          }
          if (p.type === 'Error') {
            return prev.map((x) =>
              x.id === t.id
                ? { ...x, lines: [...x.lines, { kind: 'stderr' as const, text: p.data.message }] }
                : x,
            )
          }
          return prev
        })
      })
      unDone = await listen<CodexEvent>('codex-done', (ev) => {
        const p = ev.payload
        if (p.type !== 'Done') return
        setTasks((prev) =>
          prev.map((x) =>
            x.runId === p.run_id
              ? {
                  ...x,
                  status: p.data.exit_code === 0 ? ('done' as const) : ('error' as const),
                  exitCode: p.data.exit_code,
                  endedAt: Date.now(),
                }
              : x,
          ),
        )
      })
      if (cancelled) {
        unOut?.()
        unDone?.()
      }
    }
    void init()
    return () => {
      cancelled = true
      unOut?.()
      unDone?.()
    }
  }, [])

  const runningCount = tasks.filter((t) => t.status === 'running').length

  const runAll = async () => {
    if (runningCount > 0) return
    // 启动所有未完成的子代理（跳过已完成）
    for (const t of tasks) {
      if (t.status === 'done' || t.status === 'running') continue
      if (!t.instruction.trim()) continue
      const runId = crypto.randomUUID()
      setTasks((prev) =>
        prev.map((x) =>
          x.id === t.id
            ? {
                ...x,
                runId,
                status: 'running' as const,
                startedAt: Date.now(),
                endedAt: undefined,
                lines: [...x.lines, { kind: 'system' as const, text: '▸ 子代理已启动，正在执行…' }],
              }
            : x,
        ),
      )
      runCodex(t.instruction, {
        workdir: t.workdir,
        runId,
        model: defaultModel,
        sandbox: t.sandbox === 'read-only' ? 'read-only' : null,
      }).catch((e) => {
        setTasks((prev) =>
          prev.map((x) =>
            x.id === t.id
              ? {
                  ...x,
                  status: 'error' as const,
                  lines: [...x.lines, { kind: 'stderr' as const, text: String(e) }],
                }
              : x,
          ),
        )
      })
    }
  }

  const stopOne = async (id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (t?.runId) {
      await stopCodex(t.runId).catch(() => {})
      setTasks((prev) =>
        prev.map((x) =>
          x.id === id ? { ...x, status: 'stopped' as const, endedAt: Date.now() } : x,
        ),
      )
    }
  }

  const stopAll = async () => {
    for (const t of tasks) {
      if (t.status === 'running' && t.runId) await stopOne(t.id)
    }
  }

  const addTask = () => setTasks((prev) => [...prev, newTask(defaultWorkdir)])
  const removeTask = (id: string) => setTasks((prev) => prev.filter((x) => x.id !== id))
  const patchTask = (id: string, patch: Partial<SubAgentTask>) =>
    setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  const allDone =
    tasks.length > 0 &&
    tasks.every((t) => t.status === 'done' || t.status === 'error' || t.status === 'stopped')

  if (!open) return null

  const statusBadge = (t: SubAgentTask) => {
    switch (t.status) {
      case 'pending':
        return (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">待执行</span>
        )
      case 'running':
        return (
          <span className="flex items-center gap-1 text-[11px] text-primary">
            <Loader2 className="h-3 w-3 animate-spin" /> 运行中
          </span>
        )
      case 'done':
        return (
          <span className="flex items-center gap-1 text-[11px] text-emerald-500">
            <CheckCircle2 className="h-3 w-3" /> 完成
          </span>
        )
      case 'error':
        return (
          <span className="flex items-center gap-1 text-[11px] text-red-400">
            <XCircle className="h-3 w-3" /> 失败
          </span>
        )
      case 'stopped':
        return (
          <span className="flex items-center gap-1 text-[11px] text-amber-500">
            <Square className="h-3 w-3" /> 已停止
          </span>
        )
    }
  }

  return (
    <div className="border-b border-border bg-muted/30">
      <div className="flex items-center gap-2 px-3 py-2">
        <Users className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">子代理并行</span>
        <span className="text-[11px] text-muted-foreground">
          {tasks.length} 个任务 · {runningCount} 运行中
        </span>
        {allDone && (
          <span className="flex items-center gap-1 text-[11px] text-emerald-500">
            <CheckCircle2 className="h-3 w-3" /> 全部结束
          </span>
        )}
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto px-3 pb-3">
        {tasks.map((t) => {
          const isOpen = expanded[t.id]
          return (
            <div key={t.id} className="rounded-lg border border-border bg-card p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary">
                  <Bot className="h-3.5 w-3.5" />
                </span>
                <input
                  value={t.name}
                  onChange={(e) => patchTask(t.id, { name: e.target.value })}
                  disabled={t.status === 'running'}
                  className="w-32 rounded border border-border bg-background px-2 py-1 text-xs"
                  placeholder="任务名"
                />
                <input
                  value={t.workdir}
                  onChange={(e) => patchTask(t.id, { workdir: e.target.value })}
                  disabled={t.status === 'running'}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px]"
                  placeholder="工作目录（默认会话目录）"
                />
                <select
                  value={t.sandbox}
                  onChange={(e) =>
                    patchTask(t.id, { sandbox: e.target.value as SubAgentTask['sandbox'] })
                  }
                  disabled={t.status === 'running'}
                  className="rounded border border-border bg-background px-2 py-1 text-[11px]"
                  title="权限隔离"
                >
                  <option value="inherit">继承全局沙箱</option>
                  <option value="read-only">强制只读</option>
                </select>
                {statusBadge(t)}
                {t.status === 'running' ? (
                  <button
                    onClick={() => void stopOne(t.id)}
                    className="rounded p-1 text-red-400 hover:bg-red-600/15"
                    title="停止此子代理"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => removeTask(t.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    title="删除任务"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [t.id]: !isOpen }))}
                  className="rounded p-1 text-muted-foreground hover:bg-accent"
                  title={isOpen ? '收起' : '展开指令与输出'}
                >
                  {isOpen ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              {isOpen && (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={t.instruction}
                    onChange={(e) => patchTask(t.id, { instruction: e.target.value })}
                    disabled={t.status === 'running'}
                    rows={3}
                    className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-xs"
                    placeholder="给该子代理的独立指令（如：单独改造 src/modules/a 模块，不触碰其他目录）"
                  />
                  {t.status === 'error' && (
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-500">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        子代理执行失败（可能是工具调用错误 / 模型不可用 /
                        指令为空）。可修改后重新并行执行；
                        若因权限或工具降级，可切换「继承全局沙箱」后重试。
                      </span>
                    </p>
                  )}
                  {t.lines.length > 0 && (
                    <pre className="max-h-40 overflow-y-auto rounded bg-muted/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                      {t.lines.map((l, i) => (
                        <div key={i} className={l.kind === 'stderr' ? 'text-red-400' : ''}>
                          {l.text}
                        </div>
                      ))}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2 px-3 pb-3">
        <button
          onClick={addTask}
          className="flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-accent"
        >
          <Plus className="h-3 w-3" /> 添加任务
        </button>
        <button
          onClick={() => void runAll()}
          disabled={runningCount > 0}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {runningCount > 0 ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          并行执行
        </button>
        {runningCount > 0 && (
          <button
            onClick={() => void stopAll()}
            className="flex items-center gap-1 rounded-md border border-red-500/30 bg-red-600/10 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-600/20"
          >
            <Square className="h-3 w-3" /> 全部停止
          </button>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          每个子代理独立 codex 进程并行运行，结果按任务汇总；主会话不受影响。
        </span>
      </div>
    </div>
  )
}
