/** codex exec --json 输出的 JSONL 事件 */

export type CodexJsonEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'item.completed'; item: CodexItem }
  | { type: 'turn.completed'; usage?: CodexUsage }

/** codex 输出的项目 */
export type CodexItem =
  | { id: string; type: 'error'; message: string }
  | { id: string; type: 'agent_message'; text: string }
  | {
      id: string
      type: 'tool_call'
      name: string
      arguments?: unknown
      status?: string
    }
  | {
      id: string
      type: 'approval_request'
      command?: string
      description?: string
    }
  | { id?: string; type: string; [key: string]: unknown }

/** token 使用统计 */
export interface CodexUsage {
  input_tokens?: number
  cached_input_tokens?: number
  cache_write_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
}

/** 前端渲染用的结构化消息 */
export interface CodexMessage {
  id: string
  kind: 'agent' | 'tool' | 'error' | 'system' | 'usage'
  content: string
  toolName?: string
  toolArgs?: unknown
  usage?: CodexUsage
  timestamp: number
}
