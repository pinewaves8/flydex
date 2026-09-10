import { invoke } from '@tauri-apps/api/core'

import type { ExportFormat, Session, SessionMeta } from '@/types/project'

/**
 * 旧会话(迁移前的只读归档)通道
 *
 * 会话迁移到 codex 之后,`~/.flydex/sessions/*.json` 退化为**只读归档** ——
 * 它们是那些没有 threadId 的老会话的唯一副本,不再有任何写入路径。
 *
 * 因此这里只剩三个方法:
 * - `list`   列出归档(侧边栏的「旧会话(只读)」分组)
 * - `load`   打开其中一个(渲染与迁移前完全一致)
 * - `export` 导出其中一个
 *
 * 曾经的创建/保存/删除/回收站/fork/搜索都随迁移删除 —— 那些能力现在由
 * `threadService`(codex 原生)承担。
 */
export const sessionService = {
  /** 列出旧会话元数据(不含消息内容) */
  async list(projectId?: string): Promise<SessionMeta[]> {
    return invoke<SessionMeta[]>('list_sessions', { projectId: projectId ?? null })
  },

  /** 加载旧会话详情(含消息内容) */
  async load(sessionId: string): Promise<Session | null> {
    return invoke<Session | null>('load_session', { sessionId })
  },

  /** 导出旧会话 */
  async export(sessionId: string, format: ExportFormat): Promise<string> {
    return invoke<string>('export_session', { sessionId, format })
  },
}
