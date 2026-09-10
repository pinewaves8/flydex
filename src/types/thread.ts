/**
 * codex thread / project 的前端类型
 *
 * 与 Rust 侧 `models/thread.rs` 一一对应。时间戳统一**毫秒**
 * (Rust 侧已从 codex 的 Unix 秒换算好,前端不要再做假设)。
 */

/** 会话列表行(来自 codex `thread/list`) */
export interface ThreadRow {
  id: string
  /** 用户显式设置的标题;null 时用 preview */
  name: string | null
  /** 首条用户消息(用于展示标题与空态判断) */
  preview: string
  /** fork 来源线程;用于侧边栏的 fork 树 */
  forkedFromId: string | null
  parentThreadId: string | null
  /** 所属 codex project(uuid);null = 未归属 */
  projectId: string | null
  /** 毫秒 */
  createdAt: number
  /** 毫秒 */
  updatedAt: number
  cwd: string
  modelProvider: string
  status: string
  archived: boolean
}

/** 一级搜索结果(粒度是会话,不是消息) */
export interface ThreadSearchHit {
  threadId: string
  title: string
  projectId: string | null
  /** 毫秒 */
  updatedAt: number
  snippet: string
  archived: boolean
}

/** 二级搜索结果:会话内的命中位置,用于跳转定位 */
export interface ThreadOccurrence {
  turnId: string
  itemId: string
  snippet: string
}

/** Flydex 项目 → codex project 的映射条目 */
export interface ProjectEntry {
  codexProjectId: string
  path: string
  name: string
  /** 毫秒 */
  mappedAt: number
}

/** `sync_projects` 的返回 */
export interface ProjectSyncOutcome {
  /** flydex project id → codex project id */
  mappings: Record<string, string>
  created: number
  backfilled: number
  /** 非致命问题(第三原则:不静默吞,由 UI 展示) */
  warnings: string[]
}

/** 会话的展示标题:`name` 优先,回退 `preview`(与 Rust 侧 `display_title` 同口径) */
export function threadTitle(t: ThreadRow): string {
  const name = t.name?.trim()
  if (name) return name
  const p = t.preview.replace(/[\n\r]/g, ' ').trim()
  if (!p) return '未命名会话'
  return p.length > 40 ? p.slice(0, 40) + '…' : p
}

/**
 * 一个 item（codex `ThreadItem`）
 *
 * **故意不做完整强类型**:codex 的 item 有 18 个变体且仍在演进,逐一建模会把它
 * 每一次协议变更都变成 Flydex 的编译错误。这里只固定 `type`,其余按需读取 ——
 * 识别与兜底都在 `features/codex/threadItems.ts` 一处处理。
 * (`commandExecution` 的 `id` 在协议里是可选的,故 `id` 也允许缺省。)
 *
 * 注意:字段是 **exec 风格 snake_case**(app-server 的 camelCase 已在 Rust 侧转换)。
 */
export type ThreadItem = { id?: string; type: string } & Record<string, unknown>

/** 轮的终态(codex `TurnStatus`) */
export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress'

/** 一轮对话（codex `Turn`,来自 `thread/turns/list`） */
export interface ThreadTurn {
  id: string
  status: TurnStatus
  /** 毫秒(Rust 侧已从 Unix 秒换算) */
  startedAt: number | null
  /** 毫秒 */
  completedAt: number | null
  /** 毫秒 */
  durationMs: number | null
  error: { message: string } | null
  items: ThreadItem[]
}
