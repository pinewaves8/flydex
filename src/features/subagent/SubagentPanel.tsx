import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Minimize2,
  Play,
  Plus,
  ShieldAlert,
  Square,
  Trash2,
  Users,
  Workflow,
  X,
  XCircle,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { runCodex, stopCodex } from '@/services/codex'
import { useModelStore } from '@/stores/useModelStore'
import { useSkillsStore } from '@/stores/useSkillsStore'
import { useSubagentStore } from '@/stores/useSubagentStore'
import type { CodexEvent } from '@/types/codex'
import { ROLE_PRESETS, rolePreset, type SubagentRole } from '@/types/subagent'

/**
 * 子代理并行面板（6.3 P1 + 7.2 P1 增强）
 *
 * - 6.3：每个子代理是独立 codex exec 子进程（独立 run_id + workdir），并行执行。
 * - 7.2.1 角色分派：内置 Explore（快读只读分析）/ Plan（研究）专用子代理 + 每子代理独立模型选择。
 * - 7.2.2 团队协调：任务可设置"前置任务"依赖，上游完成后把结论注入下游指令再自动启动（SendMessage 语义）。
 * - 7.2.3 后台常驻：面板收起后任务继续后台运行，ChatPanel 显示运行数徽章。
 */
export interface SubAgentTask {
  id: string
  name: string
  instruction: string
  workdir: string
  /** 权限隔离：inherit=继承全局沙箱；read-only=强制只读 */
  sandbox: 'inherit' | 'read-only'
  /** 7.2.1 子代理角色（对齐 Claude Code Explore/Plan/General） */
  role: SubagentRole
  /** 7.2.1 每子代理模型（null = 跟随全局） */
  model: string | null
  /** 7.2.2 前置任务 id：完成后把结论注入本任务再自动启动 */
  dependsOn?: string
  runId: string | null
  status: 'pending' | 'running' | 'done' | 'error' | 'stopped'
  exitCode: number | null
  lines: { kind: 'stdout' | 'stderr' | 'system' | 'agent'; text: string }[]
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
  role: 'general',
  model: null,
  dependsOn: undefined,
  runId: null,
  status: 'pending',
  exitCode: null,
  lines: [],
  lastAgent: '',
})

/** 子代理执行超时（7.2.3 健壮性）：running 超过该时长自动终止，防止后台任务卡死永久占用 */
const SUBAGENT_TIMEOUT_MS = 15 * 60 * 1000
/** 超时轮询间隔 */
const TIMEOUT_POLL_MS = 5 * 1000

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

  // 模型列表（每子代理独立模型选择）
  const modelConfig = useModelStore((s) => s.config)

  // 后台常驻：任务状态变化同步到 store（ChatPanel 徽章）
  useEffect(() => {
    const running = tasks.filter((t) => t.status === 'running').length
    useSubagentStore.getState().setBackground(running, tasks.length)
  }, [tasks])

  // 7.2.3 健壮性：超时自动终止——running 任务超过 SUBAGENT_TIMEOUT_MS 自动 stop 并标记失败，
  // 避免模型发出的坏命令（如 PowerShell 引号被上游转义破坏导致挂起）让子代理永久 running
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now()
      const toStop = tasksRef.current.filter(
        (t) => t.status === 'running' && t.startedAt && now - t.startedAt > SUBAGENT_TIMEOUT_MS,
      )
      if (toStop.length === 0) return
      for (const t of toStop) {
        if (t.runId) void stopCodex(t.runId).catch(() => {})
        setTasks((prev) =>
          prev.map((x) =>
            x.id === t.id
              ? {
                  ...x,
                  status: 'error' as const,
                  exitCode: -1,
                  endedAt: Date.now(),
                  lines: [
                    ...x.lines,
                    {
                      kind: 'stderr' as const,
                      text: `⚠️ 执行超时（${SUBAGENT_TIMEOUT_MS / 60000} 分钟），已自动终止（可能为模型命令转义异常导致挂起）`,
                    },
                  ],
                }
              : x,
          ),
        )
      }
    }, TIMEOUT_POLL_MS)
    return () => clearInterval(iv)
  }, [])

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
              // 记录最后一条 agent 消息作为"结论摘要"（供 7.2.2 依赖注入下游）
              const text = String(j.item?.text ?? '').trim()
              console.log('[subagent] agent_message received', p.run_id, text.slice(0, 60))
              return prev.map((x) =>
                x.id === t.id
                  ? {
                      ...x,
                      lastAgent: text,
                      // 追加到输出区域，让子代理结论可见（否则"完成"但看不到结论）
                      lines: text ? [...x.lines, { kind: 'agent' as const, text }] : x.lines,
                    }
                  : x,
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

  /** 启动单个子代理（返回是否成功启动） */
  const startOne = async (t: SubAgentTask): Promise<boolean> => {
    if (!t.instruction.trim()) {
      setTasks((prev) =>
        prev.map((x) =>
          x.id === t.id
            ? {
                ...x,
                lines: [
                  ...x.lines,
                  {
                    kind: 'stderr' as const,
                    text: '⚠️ 指令为空，已跳过（请先填写该子任务的指令再并行执行）',
                  },
                ],
              }
            : x,
        ),
      )
      return false
    }
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
    // 与主聊天一致：指令命中技能触发词时先注入技能纪律
    let cmd = t.instruction
    const matched = useSkillsStore.getState().matchTriggers(cmd)
    if (matched.length > 0) {
      cmd = useSkillsStore.getState().execute(matched[0].name, cmd)
    }
    runCodex(cmd, {
      workdir: t.workdir,
      runId,
      model: t.model ?? defaultModel,
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
    return true
  }

  /** 等待某任务结束（轮询 tasksRef，最多 10 分钟） */
  const waitDone = (id: string | undefined, timeoutMs = 10 * 60 * 1000): Promise<boolean> =>
    new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs
      const poll = () => {
        const t = tasksRef.current.find((x) => x.id === id)
        if (!t) return resolve(false)
        if (t.status === 'done' || t.status === 'error' || t.status === 'stopped') {
          return resolve(t.status === 'done')
        }
        if (Date.now() > deadline) return resolve(false)
        setTimeout(poll, 500)
      }
      poll()
    })

  /** 7.2.2 团队协调：上游结论注入下游指令（SendMessage 语义） */
  const injectConclusion = (down: SubAgentTask, up: SubAgentTask | undefined) => {
    if (!up || !up.lastAgent.trim()) return
    setTasks((prev) =>
      prev.map((x) =>
        x.id === down.id
          ? {
              ...x,
              instruction: `【来自上游子代理 ${up.name} 的结论】\n${up.lastAgent}\n\n${x.instruction}`,
              lines: [
                ...x.lines,
                {
                  kind: 'system' as const,
                  text: `▸ 已接收上游 ${up.name} 结论，自动启动（团队协调）`,
                },
              ],
            }
          : x,
      ),
    )
  }

  const runAll = async () => {
    if (runningCount > 0) return
    const pending = tasks.filter(
      (t) => t.status !== 'done' && t.status !== 'running' && t.status !== 'stopped',
    )
    // 7.2.2：分两阶段启动——先无依赖任务，再按依赖链启动下游并注入结论
    const ready = pending.filter((t) => !t.dependsOn || !pending.some((o) => o.id === t.dependsOn))
    const dependent = pending.filter((t) => !ready.includes(t))
    for (const t of ready) {
      await startOne(t)
    }
    for (const t of dependent) {
      const ok = await waitDone(t.dependsOn)
      if (ok) {
        const up = tasksRef.current.find((x) => x.id === t.dependsOn)
        injectConclusion(t, up)
        // 注入后取最新指令启动
        const latest = tasksRef.current.find((x) => x.id === t.id)
        if (latest) await startOne(latest)
      } else {
        setTasks((prev) =>
          prev.map((x) =>
            x.id === t.id
              ? {
                  ...x,
                  lines: [
                    ...x.lines,
                    { kind: 'stderr' as const, text: '⚠️ 前置任务未正常完成，本任务未自动启动' },
                  ],
                }
              : x,
          ),
        )
      }
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

  /** 7.2.1 角色切换：预填模板 + 默认只读沙箱 */
  const handleRoleChange = (id: string, role: SubagentRole) => {
    const preset = rolePreset(role)
    setTasks((prev) =>
      prev.map((x) =>
        x.id === id
          ? {
              ...x,
              role,
              sandbox: preset.defaultSandbox,
              instruction: x.instruction.trim() ? x.instruction : preset.template,
            }
          : x,
      ),
    )
  }

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

  const modelIds = modelConfig?.models.map((m) => m.id) ?? []

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
        {/* 7.2.3 后台常驻：收起面板，任务继续后台运行 */}
        <button
          onClick={onClose}
          className="ml-auto flex items-center gap-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="收起面板（任务继续后台运行）"
        >
          <Minimize2 className="h-4 w-4" />
        </button>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="关闭面板"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto px-3 pb-3">
        {tasks.map((t) => {
          const isOpen = expanded[t.id]
          const preset = rolePreset(t.role)
          return (
            <div key={t.id} className="rounded-lg border border-border bg-card p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded ${
                    t.role === 'general'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-violet-500/10 text-violet-500'
                  }`}
                >
                  {t.role === 'general' ? (
                    <Bot className="h-3.5 w-3.5" />
                  ) : (
                    <Workflow className="h-3.5 w-3.5" />
                  )}
                </span>
                <input
                  value={t.name}
                  onChange={(e) => patchTask(t.id, { name: e.target.value })}
                  disabled={t.status === 'running'}
                  className="w-28 rounded border border-border bg-background px-2 py-1 text-xs"
                  placeholder="任务名"
                />
                {/* 7.2.1 角色分派 */}
                <select
                  value={t.role}
                  onChange={(e) => handleRoleChange(t.id, e.target.value as SubagentRole)}
                  disabled={t.status === 'running'}
                  className="rounded border border-border bg-background px-2 py-1 text-[11px]"
                  title="子代理角色"
                >
                  {ROLE_PRESETS.map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {/* 7.2.1 每子代理模型分派 */}
                <select
                  value={t.model ?? ''}
                  onChange={(e) => patchTask(t.id, { model: e.target.value || null })}
                  disabled={t.status === 'running'}
                  className="max-w-[140px] rounded border border-border bg-background px-2 py-1 text-[11px]"
                  title={`模型分派（${preset.hintModel}）`}
                >
                  <option value="">跟随全局</option>
                  {modelIds.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
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
                {/* 7.2.2 前置任务依赖（团队协调） */}
                <select
                  value={t.dependsOn ?? ''}
                  onChange={(e) => patchTask(t.id, { dependsOn: e.target.value || undefined })}
                  disabled={t.status === 'running'}
                  className="max-w-[120px] rounded border border-border bg-background px-2 py-1 text-[11px]"
                  title="前置任务：完成后结论注入本任务再自动启动"
                >
                  <option value="">无前置</option>
                  {tasks
                    .filter((o) => o.id !== t.id && o.status !== 'stopped')
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        ⬆ {o.name || o.id.slice(0, 8)}
                      </option>
                    ))}
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
                  <div className="text-[10px] text-muted-foreground">
                    <span className="font-semibold text-violet-500">{preset.label}</span> ·{' '}
                    {preset.desc} · {preset.hintModel}
                  </div>
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
                    <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                      {t.lines.map((l, i) => (
                        <div
                          key={i}
                          className={
                            l.kind === 'stderr'
                              ? 'text-red-400'
                              : l.kind === 'agent'
                                ? 'text-primary'
                                : l.kind === 'system'
                                  ? 'italic opacity-80'
                                  : ''
                          }
                        >
                          {l.text}
                        </div>
                      ))}
                    </pre>
                  )}
                </div>
              )}

              {t.lastAgent.trim() && (
                <div className="mt-1.5 rounded bg-primary/5 px-2 py-1.5 text-[10px] text-primary">
                  <span className="font-semibold">子代理结论：</span>
                  <span className="whitespace-pre-wrap">{t.lastAgent.slice(0, 400)}</span>
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
          角色=专用子代理（Explore 只读 / Plan
          研究）；前置任务=团队协调自动接力；收起面板=后台常驻。
        </span>
      </div>
    </div>
  )
}
