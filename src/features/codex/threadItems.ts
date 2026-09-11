/**
 * codex `ThreadItem` → 前端 `CodexMessage` 的映射
 *
 * **这是唯一的映射处**:实时事件(`item/completed`)与历史重载(`thread/turns/list`)
 * 都走这里,所以「重载后的观感」不会偏离「实时流」。
 *
 * 输入 items 是 **exec 风格**(snake_case)—— app-server 的 camelCase 已在 Rust 侧
 * `appserver_client::map_item` 统一转好。所以这里不需要认识 camelCase。
 *
 * 纯函数,可单测:不依赖 zustand / React / Tauri。
 */

import type { CodexFileChange, CodexMessage, CodexUsage, TurnStats } from '@/types/codexJson'
import type { ThreadItem, ThreadTurn } from '@/types/thread'

/**
 * codex 压缩上下文后,**整个会话历史会被重写成一条** userMessage,
 * 其文本以这个固定前缀开头(来自 codex 的 `prompts/templates/compact/summary_prefix.md`)。
 *
 * 不识别它的话,这条摘要会以"你的提问"的身份糊一屏英文上去 —— 与当初注入的
 * AGENTS.md 是同一类问题,所以沿用同一套处理:折叠成一行,按需展开。
 */
export const COMPACTION_SUMMARY_PREFIX =
  'Another language model started to solve this problem and produced a summary of its thinking process.'

/** 该文本是不是 codex 的压缩摘要 */
export function isCompactionSummary(text: string): boolean {
  return text.trimStart().startsWith(COMPACTION_SUMMARY_PREFIX)
}

/**
 * 压缩后的历史长这样吗
 *
 * 判据是「第一条 item 是以摘要前缀开头的 userMessage」。压缩是**异步且没有完成
 * 通知**的(`thread/compacted` 对 v2 客户端不发,见 Rust 侧 ThreadClient::compact),
 * 所以只能靠它来判断压缩什么时候结束。
 */
export function isCompactedTurns(turns: ThreadTurn[]): boolean {
  const first = turns[0]?.items?.[0]
  if (!first || first.type !== 'user_message') return false
  return isCompactionSummary(userMessageText(first))
}

/**
 * 早期 Flydex 会把项目规范(AGENTS.md 等)拼进用户输入 —— 已修复(现交给 codex 原生
 * 加载),但**历史 turn 里还留着**这段前缀。
 *
 * 注入块的结构是「标记 + 各文件全文」,而「文件全文在哪结束」无法从数据推断
 * (codex 并不知道客户端注入过什么),所以这里**只做识别、不做切割**:识别到就交给
 * UI 折叠成一行,由用户按需展开 —— 不做有损猜测。
 */
export const INJECTED_CONTEXT_MARKER = '# 项目规范(自动加载自项目根)'

/** 该文本是否带早期 Flydex 的注入前缀 */
export function hasInjectedContext(text: string): boolean {
  return text.trimStart().startsWith(INJECTED_CONTEXT_MARKER)
}

/** 工具/MCP 调用结果的摘要（首个非空行，截 200 字） */
export function summarizeToolResult(result: unknown): string {
  if (result === null || result === undefined) return ''
  let text: string
  if (typeof result === 'string') {
    text = result
  } else {
    try {
      text = JSON.stringify(result)
    } catch {
      text = String(result)
    }
  }
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? text
  const trimmed = firstLine.trim()
  return trimmed.length > 200 ? trimmed.slice(0, 200) + '…' : trimmed
}

/** 耗时的 ` · 1.2s` 徽章（无耗时则为空串） */
export function timeBadge(durationMs: number | null | undefined): string {
  return durationMs != null ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''
}

/**
 * 命令行工具卡片的正文
 *
 * **实时与重载必须产出同一字符串** —— MessageCard 会解析首行并剥掉 `$ ` 前缀来
 * 显示命令摘要,格式一变首行解析就错。
 */
export function formatToolContent(
  command: string,
  durationMs: number | null | undefined,
  output: string,
): string {
  return `$ ${command}${timeBadge(durationMs)}${output ? `\n${output}` : ''}`
}

/** 把变化的 kind 从协议形状(`{type:'add'}`)拍平成 `'add' | 'delete' | 'update'` */
function patchKind(kind: unknown): CodexFileChange['kind'] {
  const t = typeof kind === 'string' ? kind : (kind as { type?: string } | null)?.type
  return t === 'add' || t === 'delete' || t === 'update' ? t : 'update'
}

/** 从 userMessage 的 content 数组里取出正文与附件数 */
function userTextFrom(content: unknown): { text: string; attachments: number } {
  if (!Array.isArray(content)) {
    return { text: typeof content === 'string' ? content : '', attachments: 0 }
  }
  const texts: string[] = []
  let attachments = 0
  for (const part of content) {
    const p = part as { type?: string; text?: string }
    if (p?.type === 'text' && typeof p.text === 'string') {
      texts.push(p.text)
    } else if (p?.type) {
      attachments++
    }
  }
  return { text: texts.join(''), attachments }
}

/** userMessage 的正文(供上方 isCompactedTurns 使用) */
function userMessageText(item: ThreadItem): string {
  return userTextFrom(item.content).text
}

/**
 * 思考内容:优先模型自写的 summary,回退原始思维链 content
 *
 * 注意两侧都是 `string[]`(app-server 的 `reasoning.summary` / `reasoning.content`)。
 * 早期实现按 `{text}[]` 取值,在真实数据上恒得到空串 —— 思考卡片因此从不显示。
 */
function reasoningText(item: ThreadItem): string {
  const summary = item.summary
  if (Array.isArray(summary)) {
    const s = summary.filter((x): x is string => typeof x === 'string').join('')
    if (s.trim()) return s
  }
  const content = item.content
  if (Array.isArray(content)) {
    return content.filter((x): x is string => typeof x === 'string').join('')
  }
  return typeof content === 'string' ? content : ''
}

function fmtDuration(ms: unknown): number | undefined {
  return typeof ms === 'number' && ms >= 0 ? ms : undefined
}

/**
 * 单个 item → 一条消息。返回 `null` 表示该 item 不展示(如 `sleep`)。
 *
 * `timestamp` 由调用方给(item 自身没有时间戳,用所属 turn 的时间)。
 * `opts.durationMs` 用作 item 未带 `duration_ms` 时的兜底(实时路径的本地计时)。
 */
export function mapItemToMessage(
  item: ThreadItem,
  timestamp: number,
  turnId?: string,
  opts?: { durationMs?: number },
): CodexMessage | null {
  // 消息 id 沿用 codex 的 item id(重载后同一 id,滚动定位与 React key 才能对齐);
  // 协议允许 item 无 id,此时用 类型+时间 兜底,保证仍唯一
  const id = item.id ? String(item.id) : `${item.type}-${timestamp}`
  const base = { id, source: 'codex' as const, turnId, timestamp }
  // item 自带的耗时优先;老版本 codex 不带时用调用方的本地计时兜底
  const dur = (v: unknown): number | undefined => fmtDuration(v) ?? opts?.durationMs

  switch (item.type) {
    case 'user_message': {
      const { text, attachments } = userTextFrom(item.content)
      if (!text.trim() && attachments === 0) return null
      return {
        ...base,
        kind: 'user',
        content: attachments > 0 ? `${text}\n\n[${attachments} 个附件]` : text,
      }
    }

    case 'agent_message':
      return { ...base, kind: 'agent', content: String(item.text ?? '') }

    case 'reasoning': {
      const text = reasoningText(item)
      return text.trim() ? { ...base, kind: 'reasoning', content: text } : null
    }

    case 'command_execution': {
      const command = String(item.command ?? '').trim()
      if (!command) return null
      const durationMs = dur(item.duration_ms)
      const output = String(item.aggregated_output ?? '').trim()
      const failed = item.status === 'failed' || item.status === 'declined'
      const exitCode = typeof item.exit_code === 'number' ? item.exit_code : null
      const failNote = failed
        ? `\n（${item.status === 'declined' ? '已拒绝' : '失败'}${exitCode != null ? `，退出码 ${exitCode}` : ''}）`
        : ''
      return {
        ...base,
        kind: 'tool',
        content: formatToolContent(command, durationMs, output) + failNote,
        toolName: 'command_execution',
        durationMs,
        toolResult: summarizeToolResult(output) || undefined,
      }
    }

    case 'mcp_tool_call': {
      const toolName = item.server && item.tool ? `${item.server} · ${item.tool}` : 'MCP tool'
      const failed = item.status === 'failed'
      const errMsg = (item.error as { message?: string } | null)?.message
      const durationMs = dur(item.duration_ms)
      const statusBadge = failed ? `（失败${errMsg ? `：${errMsg}` : ''}）` : '（完成）'
      return {
        ...base,
        kind: 'tool',
        content: `调用工具: ${toolName}${statusBadge}${timeBadge(durationMs)}`,
        toolName,
        toolArgs: item.arguments,
        durationMs,
        toolResult: failed ? undefined : summarizeToolResult(item.result) || undefined,
      }
    }

    case 'dynamic_tool_call': {
      const toolName = String(item.tool ?? 'tool')
      const durationMs = dur(item.duration_ms)
      return {
        ...base,
        kind: 'tool',
        content: `调用工具: ${toolName}${item.success === false ? '（失败）' : ''}${timeBadge(durationMs)}`,
        toolName,
        toolArgs: item.arguments,
        durationMs,
      }
    }

    case 'tool_call': {
      const name = String(item.name ?? 'tool')
      const durationMs = dur(item.duration_ms)
      return {
        ...base,
        kind: 'tool',
        content: `调用工具: ${name}${timeBadge(durationMs)}`,
        toolName: name,
        toolArgs: item.arguments,
        durationMs,
      }
    }

    case 'web_search': {
      const query = String(item.query ?? '')
      return { ...base, kind: 'tool', content: `网页搜索: ${query}`, toolName: 'web_search' }
    }

    case 'file_change': {
      const changes = (Array.isArray(item.changes) ? item.changes : []).map((c) => {
        const ch = c as { path?: string; kind?: unknown }
        return { path: String(ch.path ?? ''), kind: patchKind(ch.kind) }
      })
      if (changes.length === 0) return null
      return {
        ...base,
        kind: 'file_change',
        content: `文件变更：${changes.map((c) => `${c.path}（${c.kind}）`).join('，')}`,
        fileChanges: changes,
      }
    }

    case 'collab_agent_tool_call':
    case 'sub_agent_activity': {
      const tool = String(item.tool ?? item.kind ?? 'subagent')
      const argsStr = item.arguments ? JSON.stringify(item.arguments).slice(0, 200) : ''
      return {
        ...base,
        kind: 'subagent',
        content: `${tool}${argsStr ? ` · ${argsStr}` : ''}`,
        toolName: tool,
      }
    }

    // codex 的 `plan` item 是模型输出的一段计划文本,**不是** Flydex 的 plan 卡片
    // (那个是计划模式下的转换产物)。故按普通 agent 文本渲染。
    case 'plan':
      return { ...base, kind: 'agent', content: String(item.text ?? '') }

    case 'entered_review_mode':
      return { ...base, kind: 'system', content: '▸ 进入审查模式' }

    case 'exited_review_mode':
      return { ...base, kind: 'system', content: '▸ 退出审查模式' }

    case 'context_compaction':
      return { ...base, kind: 'system', content: '▸ 上下文已压缩' }

    case 'image_view':
      return { ...base, kind: 'system', content: `▸ 查看图片: ${String(item.path ?? '')}` }

    case 'image_generation':
      return {
        ...base,
        kind: 'system',
        content: `▸ 生成图片${item.saved_path ? `: ${String(item.saved_path)}` : ''}`,
      }

    case 'hook_prompt': {
      const frags = Array.isArray(item.fragments)
        ? item.fragments.map((f) => String((f as { text?: string }).text ?? '')).join('\n')
        : ''
      return { ...base, kind: 'system', content: `▸ 钩子注入:\n${frags}` }
    }

    case 'error':
      return { ...base, kind: 'error', content: String(item.message ?? '') }

    // sleep 是 codex 内部的等待项,没有展示价值
    case 'sleep':
      return null

    default:
      return null
  }
}

/** 从 turns 重建消息时的产物 */
export interface RebuiltThread {
  messages: CodexMessage[]
  /** 每个 turn 的渲染信息(id/状态/耗时),供 turn 分组与轮边界按钮使用 */
  turns: { id: string; status: ThreadTurn['status']; durationMs: number | null }[]
}

/**
 * turns → 消息(按时间正序)
 *
 * `turns` 可以是多页拼接的结果 —— 调用方负责把更早的页放在前面。
 * turn 内的 item 保持原顺序;turn 结束时的失败会补一条错误消息,
 * 否则失败的轮次在界面上会「静默结束」。
 */
export function turnsToMessages(turns: ThreadTurn[]): RebuiltThread {
  const messages: CodexMessage[] = []
  const metas: RebuiltThread['turns'] = []

  for (const turn of turns) {
    // item 没有自己的时间戳:用 turn 的完成/开始时刻兜底
    const ts = turn.completedAt ?? turn.startedAt ?? 0
    metas.push({ id: turn.id, status: turn.status, durationMs: turn.durationMs })

    for (const item of turn.items ?? []) {
      const msg = mapItemToMessage(item, ts, turn.id)
      if (msg) messages.push(msg)
    }

    if (turn.error?.message) {
      messages.push({
        id: `${turn.id}-error`,
        kind: 'error',
        source: 'codex',
        turnId: turn.id,
        content: turn.error.message,
        timestamp: ts,
      })
    }
  }

  return { messages, turns: metas }
}

/** 把一组 item 折算成本轮统计(供历史轮次的汇总展示;不做则忽略) */
export function statsFromMessages(messages: CodexMessage[], durationMs: number): TurnStats {
  const stats: TurnStats = {
    durationMs,
    toolCalls: 0,
    mcpCalls: 0,
    fileChanges: 0,
    hadErrors: false,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  for (const m of messages) {
    if (m.kind === 'tool') {
      if (m.toolName === 'command_execution') stats.toolCalls++
      else stats.mcpCalls++
    }
    if (m.kind === 'file_change') stats.fileChanges += m.fileChanges?.length ?? 0
    if (m.kind === 'error') stats.hadErrors = true
    if (m.usage) applyUsage(stats, m.usage)
  }
  return stats
}

/** 把一次 usage 累加进统计 */
export function applyUsage(stats: TurnStats, usage: CodexUsage): void {
  stats.inputTokens += usage.input_tokens ?? 0
  stats.outputTokens += usage.output_tokens ?? 0
  stats.reasoningTokens += usage.reasoning_output_tokens ?? 0
  stats.cacheReadTokens += usage.cached_input_tokens ?? 0
  stats.cacheWriteTokens += usage.cache_write_input_tokens ?? 0
}
