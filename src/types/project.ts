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
}
