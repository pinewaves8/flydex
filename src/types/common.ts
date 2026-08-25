/** 通用异步结果类型 */
export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error'

/** 带数据的异步状态 */
export interface AsyncState<T> {
  status: AsyncStatus
  data: T | null
  error: string | null
}

/** 平台类型 */
export type Platform = 'windows' | 'macos' | 'linux'
