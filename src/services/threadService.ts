import { invoke } from '@tauri-apps/api/core'

import type {
  ProjectEntry,
  ThreadSettings,
  ProjectSyncOutcome,
  ThreadOccurrence,
  ThreadRow,
  ThreadSearchHit,
} from '@/types/thread'

/** 打开会话时的首屏轮数 */
export const TURNS_PAGE_SIZE = 20

/**
 * 会话(thread)Service
 *
 * 会话的权威数据源是 codex —— 这里只是 `invoke` 的薄封装,不含业务逻辑。
 * 注意区分两条读路径:
 *   - `list` / `read`   → 元数据(列表、标题、归属)
 *   - `loadTurns` 系列  → 轮次与消息(打开会话时用,分页)
 */
export const threadService = {
  /** 把 Flydex 项目同步到 codex `project/*` 并回填已有线程归属。幂等,可每次启动调用 */
  syncProjects(): Promise<ProjectSyncOutcome> {
    return invoke<ProjectSyncOutcome>('sync_projects')
  },

  /** 本地映射缓存(codex 不可用时兜底) */
  projectMapEntries(): Promise<Record<string, ProjectEntry>> {
    return invoke<Record<string, ProjectEntry>>('project_map_entries')
  },

  /** 列出会话;`archived = true` 即回收站 */
  list(archived = false, projectId?: string | null): Promise<ThreadRow[]> {
    return invoke<ThreadRow[]>('list_threads', {
      archived,
      projectId: projectId ?? null,
    })
  },

  /** 读单个会话元数据(deep-link 时用) */
  read(threadId: string): Promise<ThreadRow | null> {
    return invoke<ThreadRow | null>('read_thread', { threadId })
  },

  /**
   * 打开会话:取最新一页轮次
   *
   * 返回 `[turns, backwardsCursor]`。**turns 是 codex 原始结构**,由
   * `features/codex/threadItems.ts` 映射成消息 —— 不要在此处加工。
   */
  loadTurns(threadId: string, limit = TURNS_PAGE_SIZE): Promise<[unknown[], string | null]> {
    return invoke<[unknown[], string | null]>('load_thread_turns', { threadId, limit })
  },

  /** 往更早的历史翻一页 */
  loadEarlierTurns(
    threadId: string,
    cursor: string,
    limit = TURNS_PAGE_SIZE,
  ): Promise<[unknown[], string | null]> {
    return invoke<[unknown[], string | null]>('load_earlier_turns', {
      threadId,
      cursor,
      limit,
    })
  },

  /** 重命名。**已归档的会话不能改名**(codex 约束) */
  rename(threadId: string, name: string): Promise<void> {
    return invoke<void>('rename_thread', { threadId, name })
  },

  /** 移入回收站(可逆) */
  archive(threadId: string): Promise<void> {
    return invoke<void>('archive_thread', { threadId })
  },

  /** 从回收站恢复 */
  unarchive(threadId: string): Promise<void> {
    return invoke<void>('unarchive_thread', { threadId })
  },

  /** 会话级 UI 偏好(codex 的 Thread 里没有这些字段,属 Flydex 侧数据) */
  getSettings(threadId: string): Promise<ThreadSettings> {
    return invoke<ThreadSettings>('get_thread_settings', { threadId })
  },

  /** 设置会话级模型覆盖。`null` = 跟随全局默认 */
  setModel(threadId: string, model: string | null): Promise<void> {
    return invoke<void>('set_thread_model', { threadId, model })
  },

  /**
   * 永久删除（**不可逆**，rollout 也会被删）
   *
   * 被 fork 引用时 codex 会拒绝 —— 错误**原样抛出**，调用方必须展示给用户，
   * 不能吞(第三原则)。级联删除后代见 P5。
   */
  delete(threadId: string): Promise<void> {
    return invoke<void>('delete_thread', { threadId })
  },

  /** 一级搜索:命中的会话 + 片段 */
  search(query: string, archived = false, limit = 50): Promise<ThreadSearchHit[]> {
    return invoke<ThreadSearchHit[]>('search_threads', { query, archived, limit })
  },

  /** 二级搜索:会话内的命中位置(跳转定位用) */
  searchOccurrences(threadId: string, query: string, limit = 50): Promise<ThreadOccurrence[]> {
    return invoke<ThreadOccurrence[]>('search_thread_occurrences', {
      threadId,
      query,
      limit,
    })
  },
}
