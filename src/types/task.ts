/** 任务状态（对齐 Claude Code /tasks） */
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled'

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done', 'cancelled']

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '待办',
  in_progress: '进行中',
  done: '已完成',
  cancelled: '已取消',
}

/** 任务优先级 */
export type TaskPriority = 'high' | 'medium' | 'low'

export const TASK_PRIORITIES: TaskPriority[] = ['high', 'medium', 'low']

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

/** 持久化任务 */
export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  labels: string[]
  projectId?: string | null
  sessionId?: string | null
  createdAt: number
  updatedAt: number
}

/** 新建任务入参 */
export interface TaskInput {
  title: string
  description?: string
  priority?: TaskPriority
  projectId?: string | null
  sessionId?: string | null
}
