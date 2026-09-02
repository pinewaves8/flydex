import type { CodexMessage } from './codexJson'
import type { Platform } from './common'

/** 项目配置 */
export interface Project {
  id: string
  name: string
  path: string
  platform: Platform
  createdAt: number
  updatedAt: number
}

/** 会话状态 */
export type SessionStatus = 'idle' | 'running' | 'completed' | 'error'

/** Fork 来源信息 */
export interface ForkedFrom {
  sessionId: string
  /** 从原会话的第几条消息开始（0-based，含） */
  messageIndex: number
}

/** 对话会话（完整数据） */
export interface Session {
  id: string
  projectId: string
  title: string
  workdir: string
  threadId: string | null
  /** 会话级模型覆盖（null 用全局默认） */
  model: string | null
  messages: CodexMessage[]
  createdAt: number
  updatedAt: number
  /** 软删除时间戳（null = 未删除，进入回收站时设置） */
  deletedAt: number | null
  /** Fork 来源（null = 不是 fork） */
  forkedFrom: ForkedFrom | null
}

/** 会话元数据（列表用，不含 messages） */
export interface SessionMeta {
  id: string
  projectId: string
  title: string
  workdir: string
  /** 会话级模型覆盖 */
  model?: string | null
  createdAt: number
  updatedAt: number
  /** 消息数量（列表展示用） */
  messageCount?: number
  /** 软删除时间戳 */
  deletedAt?: number | null
  /** Fork 来源 */
  forkedFrom?: ForkedFrom | null
}

/** 搜索结果（带匹配片段） */
export interface SessionSearchHit {
  session: SessionMeta
  /** 匹配的字段（title 或 content） */
  matchField: 'title' | 'content'
  /** 匹配的片段（最多 120 字符） */
  snippet: string
}

/** 导出格式 */
export type ExportFormat = 'json' | 'markdown'
