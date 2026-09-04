import { CheckCircle2, Circle, ListChecks, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { taskService } from '@/services/taskService'
import { useProjectStore } from '@/stores/useProjectStore'
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@/types/task'

const STATUS_STYLE: Record<TaskStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-blue-500/15 text-blue-400',
  done: 'bg-green-500/15 text-green-400',
  cancelled: 'bg-red-500/15 text-red-400',
}

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  high: 'text-red-400',
  medium: 'text-amber-400',
  low: 'text-muted-foreground',
}

/** 相对时间（简短） */
function relTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

/** 新建/编辑表单（内联弹层） */
function TaskForm({
  initial,
  onSubmit,
  onCancel,
  busy,
}: {
  initial: { title: string; description: string; priority: TaskPriority; status: TaskStatus } | null
  onSubmit: (v: {
    title: string
    description: string
    priority: TaskPriority
    status: TaskStatus
  }) => void
  onCancel: () => void
  busy: boolean
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? 'medium')
  const [status, setStatus] = useState<TaskStatus>(initial?.status ?? 'todo')

  const submit = () => {
    if (!title.trim()) return
    onSubmit({ title: title.trim(), description, priority, status })
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="任务标题（必填）"
        autoFocus
        className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="描述（可选）"
        rows={2}
        className="w-full resize-none rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex items-center gap-2">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          className="rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none"
        >
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              优先级：{TASK_PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        {initial && (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
            className="rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none"
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        )}
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          取消
        </button>
        <button
          onClick={submit}
          disabled={busy || !title.trim()}
          className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          保存
        </button>
      </div>
    </div>
  )
}

/** 任务面板（7.4.2 Tasks API） */
export function TaskPanel({
  open,
  onClose,
  projectId,
  sessionId,
}: {
  open: boolean
  onClose: () => void
  projectId?: string | null
  sessionId?: string | null
}) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<'all' | TaskStatus>('all')
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const sessions = useProjectStore((s) => s.sessions)

  const reload = async () => {
    setLoading(true)
    try {
      setTasks(await taskService.list(projectId))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      void reload()
    }
  }, [open, projectId])

  const sessionTitle = useMemo(() => {
    const map = new Map(sessions.map((s) => [s.id, s.title]))
    return (id?: string | null) => (id ? (map.get(id) ?? null) : null)
  }, [sessions])

  if (!open) return null

  const filtered = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter)

  const handleCreate = async (v: {
    title: string
    description: string
    priority: TaskPriority
    status: TaskStatus
  }) => {
    setBusy(true)
    setError('')
    try {
      await taskService.create({
        title: v.title,
        description: v.description,
        priority: v.priority,
        projectId,
        sessionId,
      })
      setCreating(false)
      await reload()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleUpdate = async (id: string, patch: Partial<Task>) => {
    setBusy(true)
    setError('')
    try {
      await taskService.update(id, patch)
      setEditing(null)
      await reload()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('删除该任务？')) return
    setBusy(true)
    setError('')
    try {
      await taskService.remove(id)
      await reload()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const nextStatus = (s: TaskStatus): TaskStatus => {
    if (s === 'todo') return 'in_progress'
    if (s === 'in_progress') return 'done'
    return 'todo'
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <ListChecks className="h-4 w-4 text-primary" />
            任务（Tasks）
            <span className="ml-1 text-[10px] text-muted-foreground">
              {tasks.length} 项 · {tasks.filter((t) => t.status === 'done').length} 完成
            </span>
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 过滤 + 新建 */}
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2">
          {(['all', ...TASK_STATUSES] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                filter === f
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'
              }`}
            >
              {f === 'all' ? '全部' : TASK_STATUS_LABEL[f]}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => setCreating((c) => !c)}
            className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-3 w-3" />
            新建任务
          </button>
        </div>

        {error && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-1.5 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {creating && (
            <div className="mb-2">
              <TaskForm
                initial={null}
                onSubmit={handleCreate}
                onCancel={() => setCreating(false)}
                busy={busy}
              />
            </div>
          )}
          {loading && tasks.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              加载中…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {tasks.length === 0 ? '暂无任务，点击「新建任务」开始' : '当前过滤条件下无任务'}
            </div>
          ) : (
            filtered.map((task) =>
              editing?.id === task.id ? (
                <div key={task.id} className="mb-1.5">
                  <TaskForm
                    initial={{
                      title: task.title,
                      description: task.description,
                      priority: task.priority,
                      status: task.status,
                    }}
                    onSubmit={(v) =>
                      handleUpdate(task.id, {
                        title: v.title,
                        description: v.description,
                        priority: v.priority,
                        status: v.status,
                      })
                    }
                    onCancel={() => setEditing(null)}
                    busy={busy}
                  />
                </div>
              ) : (
                <div
                  key={task.id}
                  className="group mb-1.5 flex items-start gap-2 rounded-lg border border-border/60 px-3 py-2 hover:border-border"
                >
                  <button
                    onClick={() => handleUpdate(task.id, { status: nextStatus(task.status) })}
                    className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
                    title={
                      task.status === 'todo'
                        ? '标记为进行中'
                        : task.status === 'in_progress'
                          ? '标记为已完成'
                          : '重置为待办'
                    }
                  >
                    {task.status === 'done' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`truncate text-sm ${task.status === 'done' ? 'text-muted-foreground line-through' : ''}`}
                      >
                        {task.title}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-px text-[10px] ${STATUS_STYLE[task.status]}`}
                      >
                        {TASK_STATUS_LABEL[task.status]}
                      </span>
                      <span className={`shrink-0 text-[10px] ${PRIORITY_STYLE[task.priority]}`}>
                        {TASK_PRIORITY_LABEL[task.priority]}优先级
                      </span>
                    </div>
                    {task.description && (
                      <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                        {task.description}
                      </div>
                    )}
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground/70">
                      <span>{relTime(task.updatedAt)}</span>
                      {task.labels.map((l) => (
                        <span key={l} className="rounded bg-muted px-1">
                          {l}
                        </span>
                      ))}
                      {sessionTitle(task.sessionId) && (
                        <span className="truncate">· 会话：{sessionTitle(task.sessionId)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => setEditing(task)}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="编辑"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                      title="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ),
            )
          )}
        </div>
      </div>
    </div>
  )
}
