import { invoke } from '@tauri-apps/api/core'

import type { ExportFormat, Session, SessionMeta, SessionSearchHit } from '@/types/project'

/**
 * 会话管理 Service
 *
 * 封装与 Tauri 后端的会话相关 IPC 调用。
 */
export const sessionService = {
  /** 列出会话元数据（不含消息内容，不含已删除） */
  async list(projectId?: string): Promise<SessionMeta[]> {
    return invoke<SessionMeta[]>('list_sessions', { projectId: projectId ?? null })
  },

  /** 列出回收站（已软删除的会话） */
  async listTrashed(): Promise<SessionMeta[]> {
    return invoke<SessionMeta[]>('list_trashed_sessions')
  },

  /** 加载会话详情（含消息内容） */
  async load(sessionId: string): Promise<Session | null> {
    return invoke<Session | null>('load_session', { sessionId })
  },

  /** 创建会话 */
  async create(
    projectId: string,
    title: string,
    workdir: string,
    model?: string | null,
  ): Promise<Session> {
    return invoke<Session>('create_session', {
      projectId,
      title,
      workdir,
      model: model ?? null,
    })
  },

  /** 保存会话（全量覆盖） */
  async save(session: Session): Promise<void> {
    await invoke('save_session', { session })
  },

  /** 硬删除会话（永久删除） */
  async delete(sessionId: string): Promise<void> {
    await invoke('delete_session', { sessionId })
  },

  /** 重命名会话 */
  async rename(sessionId: string, title: string): Promise<void> {
    await invoke('rename_session', { sessionId, title })
  },

  /** 把会话移到回收站（软删除） */
  async trash(sessionId: string): Promise<void> {
    await invoke('trash_session', { sessionId })
  },

  /** 从回收站恢复会话 */
  async restore(sessionId: string): Promise<void> {
    await invoke('restore_session', { sessionId })
  },

  /** 从指定消息索引 fork 会话 */
  async fork(sessionId: string, messageIndex: number): Promise<Session> {
    return invoke<Session>('fork_session', { sessionId, messageIndex })
  },

  /** 全文搜索 */
  async search(query: string, projectId?: string): Promise<SessionSearchHit[]> {
    return invoke<SessionSearchHit[]>('search_sessions', {
      query,
      projectId: projectId ?? null,
    })
  },

  /** 导出会话 */
  async export(sessionId: string, format: ExportFormat): Promise<string> {
    return invoke<string>('export_session', { sessionId, format })
  },
}
