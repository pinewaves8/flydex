import { invoke } from '@tauri-apps/api/core'

import type { Task, TaskInput, TaskPriority, TaskStatus } from '@/types/task'

/** 任务 CRUD（7.4.2 Tasks API） */
export const taskService = {
  /** 列出任务；传 projectId 按项目过滤，否则返回全部（按更新时间倒序） */
  list(projectId?: string | null): Promise<Task[]> {
    return invoke<Task[]>('task_list', { projectId: projectId || null })
  },

  /** 创建任务 */
  create(input: TaskInput): Promise<Task> {
    return invoke<Task>('task_create', {
      title: input.title,
      description: input.description ?? '',
      priority: input.priority ?? 'medium',
      projectId: input.projectId ?? null,
      sessionId: input.sessionId ?? null,
      labels: [],
    })
  },

  /** 更新任务（未传字段保持不变） */
  update(
    id: string,
    patch: {
      title?: string
      description?: string
      status?: TaskStatus
      priority?: TaskPriority
    },
  ): Promise<Task> {
    return invoke<Task>('task_update', {
      id,
      title: patch.title ?? null,
      description: patch.description ?? null,
      status: patch.status ?? null,
      priority: patch.priority ?? null,
      labels: null,
    })
  },

  /** 删除任务 */
  remove(id: string): Promise<null> {
    return invoke<null>('task_delete', { id })
  },
}
