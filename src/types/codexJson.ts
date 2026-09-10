/** codex exec --json 输出的 JSONL 事件 */

export type CodexJsonEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'item.started'; item: CodexItem }
  /** `turn_id` 来自 codex 通知,用于把消息归到正确的轮 */
  | { type: 'item.completed'; item: CodexItem; turn_id?: string | null }
  | { type: 'turn.completed'; usage?: CodexUsage }
  | { type: 'item.agent_message.delta'; item_id: string | null; delta: string }
  | { type: 'item.reasoning.delta'; item_id: string | null; delta: string }
  | { type: 'item.reasoning.summary.delta'; item_id: string | null; delta: string }
  | { type: 'turn.plan.updated'; explanation?: string | null; plan: TurnPlanStep[] }
  | { type: 'turn.diff.updated'; diff: string }
  | { type: 'error'; message: string }

/**
 * codex 输出的项目(item)
 *
 * 这里是 **exec 风格**(snake_case)。app-server 的 `ThreadItem` 是 camelCase,
 * 由 Rust 侧 `appserver_client::map_item` 统一转成这个形状 —— 实时事件与历史重载
 * 走的是同一个转换,所以这个类型是两条路径的唯一契约。
 */
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
      /** 规则引擎决策：ask / auto_accept / auto_deny */
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
      duration_ms?: number | null
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

/**
 * 消息的产地
 *
 * - `codex`：由 codex 的 turn/item 重建而来,id 就是 codex 的 item id。重载后仍在。
 * - `local`：前端在事件流中实时合成的卡片(turn_summary / reflection / plan /
 *   review / deny / usage / system),codex 侧不存在,**重载后不会回来**。
 *
 * 见 AGENTS.md「状态归 codex,表现归 Flydex」:这是刻意的取舍,不是缺陷。
 */
export type CodexMessageSource = 'codex' | 'local'

/** 前端渲染用的结构化消息 */
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
  /** 来自 codex 还是前端合成（默认按 local 处理） */
  source?: CodexMessageSource
  /** 所属 turn（codex 来源才有）。turn 分组、分支定位、跳转都靠它 */
  turnId?: string
  toolName?: string
  toolArgs?: unknown
  usage?: CodexUsage
  /** file_change 消息的文件变更列表 */
  fileChanges?: CodexFileChange[]
  /** deny 卡片展示的命中的规则与原因（用户规则/内置规则说明） */
  reason?: string
  /** 工具/MCP 调用耗时（毫秒） */
  durationMs?: number
  /** 工具/MCP 调用的结果摘要（首行截 200 字） */
  toolResult?: string
  /** 本轮统计，仅 turn_summary 使用 */
  turnStats?: TurnStats
  timestamp: number
}

/** 本轮统计（turn_summary 消息使用） */
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
