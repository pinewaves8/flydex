/** codex exec --json 杈撳嚭鐨?JSONL 浜嬩欢 */

export type CodexJsonEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'item.started'; item: CodexItem }
  | { type: 'item.completed'; item: CodexItem }
  | { type: 'turn.completed'; usage?: CodexUsage }
  | { type: 'item.agent_message.delta'; item_id: string | null; delta: string }
  | { type: 'item.reasoning.delta'; item_id: string | null; delta: string }
  | { type: 'item.reasoning.summary.delta'; item_id: string | null; delta: string }
  | { type: 'turn.plan.updated'; explanation?: string | null; plan: TurnPlanStep[] }
  | { type: 'turn.diff.updated'; diff: string }
  | { type: 'error'; message: string }

/** codex 杈撳嚭鐨勯」鐩?*/
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
      /** 瑙勫垯寮曟搸鍐崇瓥锛歛sk / auto_accept / auto_deny */
      decision?: string
      reason?: string
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

/** token 浣跨敤缁熻?*/
export interface CodexUsage {
  input_tokens?: number
  cached_input_tokens?: number
  cache_write_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
}

/** 鏂囦欢鍙樻洿椤癸紙file_change item 鍐呯殑鍗曚釜鏂囦欢锛?*/
export interface CodexFileChange {
  path: string
  kind: 'add' | 'delete' | 'update'
}

/** 鍓嶇湪娓叉煋鐢ㄧ殑缁撴瀯鍖栨秷鎭?*/
export interface CodexMessage {
  id: string
  kind:
    | 'user'
    | 'agent'
    | 'tool'
    | 'error'
    | 'system'
    | 'reasoning'
    | 'subagent'
    | 'usage'
    | 'file_change'
    | 'plan'
    | 'review'
    | 'deny'
    | 'turn_summary'
    | 'reflection'
  content: string
  toolName?: string
  toolArgs?: unknown
  usage?: CodexUsage
  /** file_change 娑堟伅鐨勬枃浠跺彉鏇村垪琛?*/
  fileChanges?: CodexFileChange[]
  /** deny 鍗″榻灞曠ず鐨勫懡涓浠ュ師鍥狅紙鐢ㄦ埛瑙勫垯/鍐呯疆瑙勫垯璇存槑锛?*/
  reason?: string
  /** 宸ュ叿/MCP 璋冪敤鑰楁椂锛堟椃绉掞級 */
  durationMs?: number
  /** 宸ュ叿/MCP 璋冪敤鐨勭粨鏋滄憳瑕侊紙棣栬党建200瀛楋級 */
  toolResult?: string
  /** 鏈瑁″熀鏁帮紝浠呮Turn_summary 浣跨敤锛?*/
  turnStats?: TurnStats
  timestamp: number
}

/** 鏈瑁″仠浣缁熻锛坱urn_summary 娑堟伅浣跨敤锛?*/
export interface TurnStats {
  durationMs: number
  toolCalls: number
  mcpCalls: number
  fileChanges: number
  hadErrors: boolean
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** 模型任务清单的一步(来自 codex `turn/plan/updated`,对齐 Claude Code 的 TodoWrite) */
export interface TurnPlanStep {
  step: string
  status: 'pending' | 'inProgress' | 'completed'
}
