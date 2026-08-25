import { invoke } from '@tauri-apps/api/core'

import type { Session, SessionMeta } from '@/types/project'

/**
 * 会话管理 Service
 *
 * 封装与 Tauri 后端的会话相关 IPC 调用。
 */
export const sessionService = {
  /** 列出会话元数据（不含消息内容） */
  async list(projectId?: string): Promise<SessionMeta[]> {
    return invoke<SessionMeta[]>('list_sessions', { projectId: projectId ?? null })
  },

  /** 加载会话详情（含消息内容） */
  async load(sessionId: string): Promise<Session | null> {
    return invoke<Session | null>('load_session', { sessionId })
  },

  /** 创建会话 */
  async create(projectId: string, title: string, workdir: string): Promise<Session> {
    return invoke<Session>('create_session', { projectId, title, workdir })
  },

  /** 保存会话（全量覆盖） */
  async save(session: Session): Promise<void> {
    await invoke('save_session', { session })
  },

  /** 删除会话 */
  async delete(sessionId: string): Promise<void> {
    await invoke('delete_session', { sessionId })
  },

  /** 重命名会话 */
  async rename(sessionId: string, title: string): Promise<void> {
    await invoke('rename_session', { sessionId, title })
  },
}
