// Codex 事件类型（与 Rust 端 CodexEvent 对应）
// run_id 平铺在顶层：子代理并行时主会话按 run_id 过滤，避免互相污染

export type CodexEvent =
  | { run_id: string; type: 'Started'; data: { pid: number } }
  | { run_id: string; type: 'Output'; data: { text: string } }
  | { run_id: string; type: 'Error'; data: { message: string } }
  | { run_id: string; type: 'Json'; data: unknown }
  | { run_id: string; type: 'Done'; data: { exit_code: number } }

export type CodexStatus = 'idle' | 'running' | 'done' | 'error'

export interface CodexOutputLine {
  id: number
  text: string
  kind: 'stdout' | 'stderr' | 'json' | 'system'
}
