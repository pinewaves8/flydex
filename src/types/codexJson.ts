/** codex exec --json 输出的 JSONL 事件 */

export type CodexJsonEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'item.started'; item: CodexItem }
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
      type: 'mcp_tool_call'
      server?: string
      tool?: string
      arguments?: unknown
      result?: unknown
      status?: 'in_progress' | 'completed' | 'failed'
      error?: { message?: string } | null
    }
  | {
      id: string
      type: 'approval_request'
      command?: string
      description?: string
    }
  | {
      id?: string
      type: 'command_execution'
      command?: string
      status?: 'in_progress' | 'completed'
      aggregated_output?: string
      exit_code?: number | null
    }
  | {
      id: string
      type: 'file_change'
      changes: CodexFileChange[]
      status?: string
    }

/** token 使用统计 */
export interface CodexUsage {
  input_tokens?: number
  cached_input_tokens?: number
  cache_write_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
}

/** 文件变更项（file_change item 内的单个文件） */
export interface CodexFileChange {
  path: string
  kind: 'add' | 'delete' | 'update'
}

/** 前端渲染用的结构化消息 */
export interface CodexMessage {
  id: string
  kind: 'agent' | 'tool' | 'error' | 'system' | 'usage' | 'file_change'
  content: string
  toolName?: string
  toolArgs?: unknown
  usage?: CodexUsage
  /** file_change 消息的文件变更列表 */
  fileChanges?: CodexFileChange[]
  timestamp: number
}
