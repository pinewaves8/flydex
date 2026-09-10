import { invoke } from '@tauri-apps/api/core'

import type { Project } from '@/types/project'
import type { ProjectDeleteOutcome } from '@/types/thread'

/**
 * 项目管理 Service
 *
 * 封装与 Tauri 后端的项目相关 IPC 调用。
 */
export const projectService = {
  /** 列出所有项目 */
  async list(): Promise<Project[]> {
    return invoke<Project[]>('list_projects')
  },

  /** 创建项目 */
  async create(name: string, path: string): Promise<Project> {
    return invoke<Project>('create_project', { name, path })
  },

  /** 更新项目 */
  async update(project: Project): Promise<void> {
    await invoke('update_project', { project })
  },

  /** 删除项目 */
  /** 删除项目（连带删除其全部会话）。返回结果里可能带 failures，调用方需展示 */
  async delete(projectId: string): Promise<ProjectDeleteOutcome> {
    return invoke<ProjectDeleteOutcome>('delete_project', { projectId })
  },
}
