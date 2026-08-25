// Codex 事件类型（与 Rust 端 CodexEvent 对应）

export type CodexEvent =
  | { type: 'Output'; data: { text: string } }
  | { type: 'Error'; data: { message: string } }
  | { type: 'Done'; data: { exit_code: number } }

export type CodexStatus = 'idle' | 'running' | 'done' | 'error'

export interface CodexOutputLine {
  id: number
  text: string
  kind: 'stdout' | 'stderr'
}
