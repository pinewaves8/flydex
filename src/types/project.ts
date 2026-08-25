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

/** 对话会话 */
export interface Session {
  id: string
  projectId: string
  title: string
  status: SessionStatus
  createdAt: number
  updatedAt: number
}
