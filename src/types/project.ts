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
  createdAt: number
  updatedAt: number
}
