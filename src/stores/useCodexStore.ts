import { create } from 'zustand'

import type { CodexOutputLine, CodexStatus } from '@/types/codex'
import type { CodexMessage, CodexFileChange, CodexUsage, TurnPlanStep } from '@/types/codexJson'

/** 待审批的操作（由 codex approval_request 触发）*/
export interface CodexApproval {
  id: string
  command?: string
  description?: string
  /** 规则引擎决策：ask=审批截屏 auto_accept/auto_deny=自动执行/拒绝（仅通知）*/
  decision?: string
  reason?: string
}

/** 正在执行的命令（实时命令面板）*/
export interface CodexRunningCommand {
  id: string
  command: string
  startedAt: number
}

/**
 * 流式实时预览(直接来自 codex 的 delta 通知)
 *
 * 与旧的 `CodexStreaming` 不同:那是"等全文到了再用定时器逐字揭示"的假流式 ——
 * 首字延迟 = 整段生成时间,还要再叠加一段固定速率的打字时间。这里直接累积模型增量,
 * 第一个 token 到达即可显示。
 */
export interface CodexLive {
  /** agent=正式回答;reasoning-summary=摘要思考(优先);reasoning=原始思维链(回退) */
  kind: 'agent' | 'reasoning-summary' | 'reasoning'
  text: string
}

/**
 * 一个 turn 的渲染元信息(历史重载用)
 *
 * 消息自身带 `turnId`,足以分组;但轮的状态与耗时只有 turn 上有,
 * 用于显示轮标题、失败原因与轮边界的「在此分叉」按钮(P6)。
 */
export interface ThreadTurnMeta {
  id: string
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress'
  durationMs: number | null
}

/** 增量文本节流:模型每秒可发几十个 delta,合并到 ~60ms 一次 setState */
const LIVE_FLUSH_INTERVAL_MS = 60
let liveBuffer: CodexLive | null = null
let liveFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushLive(): void {
  if (liveFlushTimer) {
    clearTimeout(liveFlushTimer)
    liveFlushTimer = null
  }
  if (liveBuffer === null) return
  useCodexStore.setState({ live: { ...liveBuffer } })
}

/** 追加一段流式增量(由事件层调用) */
export function appendLiveDelta(kind: CodexLive['kind'], delta: string): void {
  if (liveBuffer === null) {
    liveBuffer = { kind, text: delta }
  } else if (liveBuffer.kind === kind) {
    liveBuffer.text += delta
  } else if (liveBuffer.kind === 'reasoning-summary' && kind === 'reasoning') {
    // 摘要优先:已有摘要时忽略原始思维链,避免用几千字原文盖掉精简摘要
    return
  } else {
    // 切换类型(如思考→回答)则重新开始累积
    liveBuffer = { kind, text: delta }
  }
  if (!liveFlushTimer) {
    liveFlushTimer = setTimeout(flushLive, LIVE_FLUSH_INTERVAL_MS)
  }
}

/** 清空流式预览(对应的正式消息即将落地时) */
export function clearLive(): void {
  liveBuffer = null
  flushLive()
  useCodexStore.setState({ live: null })
}

/** 输出 buffer 节流刷新间隔（毫秒） */
const OUTPUT_FLUSH_INTERVAL_MS = 60

/** 消息列表最大条数（超出时移除最早的） */
const MAX_MESSAGES = 200

/** 输出列表最大行数（超出时移除最早的） */
const MAX_OUTPUT_LINES = 1000

interface CodexState {
  status: CodexStatus
  output: CodexOutputLine[]
  messages: CodexMessage[]
  exitCode: number | null
  threadId: string | null
  usage: CodexUsage | null
  /** 当前运行 id（用于计次、停止）*/
  pendingRunId: string | null
  /**
   * 正在跑的那一轮 id(codex turnId)
   *
   * 插话(`turn/steer`)必须把当前活跃轮的 id 当 `expectedTurnId` 传回去 ——
   * 那是乐观并发保护,传错会被直接拒(实测)。
   */
  liveTurnId: string | null
  /** 正在执行的命令（实时面板）*/
  runningCommands: CodexRunningCommand[]
  /** 待审批项 */
  approval: CodexApproval | null
  /** 打字机流式覆写状态（agent_message 逐字显示）*/
  /** 流式实时预览(agent: 正式回答 / reasoning: 思考内容) */
  live: CodexLive | null
  /** 已处理的 codex item id（事件级去重等重防止重复） */
  processedItemIds: string[]
  lineId: number
  /** 本轮开始时间戳（用于显示每轮耗时）*/
  runStartedAt: number | null
  /** 当前 run 的工作目录（写入后审计审查：turn 完成后对比 git 工作区） */
  runWorkdir: string | null
  /** 已展示过的文件变更 key（path|kind），避免重复生成文件变更卡片 */
  seenFileChanges: string[]
  /** 本轮开始时的 git 工作区变更快照（用于只展示本轮新增的变化，避免误刷新历史文件） */
  baselineFileChanges: CodexFileChange[]
  /** 计划模式开启（开启后发送生成计划而非直接执行，批准后再执行） */
  planMode: boolean
  /** 当前会话 id（用于自动保存）；null 表示不保存*/
  currentSessionId: string | null
  /** 已加载的 turn 元信息（按时间正序），与 messages 里的 turnId 对应 */
  turns: ThreadTurnMeta[]
  /** 再往前翻一页用的游标；null = 已到最开头 */
  turnsCursor: string | null
  /** 待写入输入框的命令前缀(由 SkillPalette 等外部触发);InputBox 监听后清空 */
  pendingCommand: string | null
  setPendingCommand: (cmd: string | null) => void
  /** 模型当前的任务清单(来自 codex `turn/plan/updated`,含每步真实状态)。
   * 取代了旧的「FIFO 猜进度 + 2s 轮询」。 */
  livePlan: { explanation: string | null; steps: TurnPlanStep[] } | null
  setLivePlan: (p: { explanation: string | null; steps: TurnPlanStep[] } | null) => void
  /** 最近一个 tool 完成的时间戳(ms)—— ToolCard 用 key 触发一次性完成动画 */
  lastToolCompleteAt: number
  /** 待滚动到指定消息 ID(搜索结果跳转用)—— ChatPanel useEffect 监听后清除 */
  pendingScrollToMessageId: string | null
  setPendingScrollToMessageId: (id: string | null) => void
  setPlanMode: (v: boolean) => void
  reviewMode: boolean
  setReviewMode: (v: boolean) => void
  setStatus: (status: CodexStatus) => void
  appendOutput: (line: Omit<CodexOutputLine, 'id'>) => void
  appendMessage: (message: Omit<CodexMessage, 'id' | 'timestamp'>) => string
  /**
   * 插入一条 codex 来源的消息(**沿用 codex 的 item id**)
   *
   * 与 `appendMessage`(前端合成卡,id 随机)分开:codex 来源的消息在重载后会被
   * 从 turns 重建,只有 id 相同才能保证「实时」与「重载」是同一批消息 ——
   * 滚动定位(P7)、React key 都依赖这点。已存在则跳过。
   */
  appendCodexMessage: (message: CodexMessage) => string
  updateMessageKind: (id: string, kind: CodexMessage['kind']) => void
  markItemProcessed: (id: string) => boolean
  clearProcessedItems: () => void
  setExitCode: (code: number | null) => void
  setThreadId: (id: string | null) => void
  setUsage: (usage: CodexUsage | null) => void
  setPendingRunId: (id: string | null) => void
  setLiveTurnId: (id: string | null) => void
  setRunStartedAt: (ts: number | null) => void
  setRunWorkdir: (w: string | null) => void
  markFileChangesSeen: (keys: string[]) => void
  setBaselineFileChanges: (changes: CodexFileChange[]) => void
  upsertRunningCommand: (cmd: CodexRunningCommand) => void
  removeRunningCommand: (id: string) => void
  setRunningCommands: (cmds: CodexRunningCommand[]) => void
  setApproval: (approval: CodexApproval | null) => void

  reset: () => void
  /** 设置当前会话 id（启用自动保存）；传 null 关闭自动保存 */
  setCurrentSessionId: (id: string | null) => void
  /** 加载会话数据（旧会话只读渲染用，见 P8）*/
  loadSession: (data: { messages: CodexMessage[]; threadId: string | null }) => void
  /** 从 codex turns 重建会话（打开线程时用；P3 起这是主路径） */
  loadThread: (data: {
    threadId: string
    messages: CodexMessage[]
    turns: ThreadTurnMeta[]
    /** 更早历史的游标；null 表示没有更早的了 */
    cursor: string | null
  }) => void
  /** 往更早的历史翻页：把更早的 turns 插到最前面（滚动位置由 UI 负责） */
  prependTurns: (data: {
    messages: CodexMessage[]
    turns: ThreadTurnMeta[]
    cursor: string | null
  }) => void
  /** 刷新输出 buffer（流结束后调用） */
  flushOutputBuffer: () => void
}

/**
 * 流式输出节流 buffer
 * - 缓存 appendOutput 调用，每 60ms 批量 flush 到 state
 * - 避免每个 token 都触发一次 setState 导致重渲染
 */
let outputBuffer: Omit<CodexOutputLine, 'id'>[] = []
let outputFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushOutputBuffer() {
  if (outputBuffer.length === 0) return
  const batch = outputBuffer
  outputBuffer = []
  if (outputFlushTimer) {
    clearTimeout(outputFlushTimer)
    outputFlushTimer = null
  }
  // 直接操作 store 内部状态，绕过组件订阅
  useCodexStore.setState((state) => {
    let lineId = state.lineId
    const newLines = batch.map((line) => {
      const id = lineId++
      return { ...line, id }
    })
    // 容量限制：超出 MAX_OUTPUT_LINES 时移除最早的
    let output = [...state.output, ...newLines]
    if (output.length > MAX_OUTPUT_LINES) {
      output = output.slice(output.length - MAX_OUTPUT_LINES)
    }
    return { output, lineId }
  })
}

function scheduleOutputFlush() {
  if (outputFlushTimer) return
  outputFlushTimer = setTimeout(() => {
    outputFlushTimer = null
    flushOutputBuffer()
  }, OUTPUT_FLUSH_INTERVAL_MS)
}

const useCodexStore = create<CodexState>((set, get) => ({
  status: 'idle',
  output: [],
  messages: [],
  exitCode: null,
  threadId: null,
  usage: null,
  pendingRunId: null,
  liveTurnId: null,
  runningCommands: [],
  approval: null,
  live: null,
  processedItemIds: [],
  lineId: 0,
  runStartedAt: null,
  runWorkdir: null,
  seenFileChanges: [],
  baselineFileChanges: [],
  planMode: false,
  currentSessionId: null,
  turns: [],
  turnsCursor: null,
  pendingCommand: null,
  livePlan: null,
  lastToolCompleteAt: 0,
  pendingScrollToMessageId: null,
  reviewMode: false,
  setReviewMode: (v) => set({ reviewMode: v }),
  setPendingCommand: (cmd) => set({ pendingCommand: cmd }),
  setLivePlan: (p) => set({ livePlan: p }),
  setPendingScrollToMessageId: (id) => set({ pendingScrollToMessageId: id }),
  setPlanMode: (v) => set({ planMode: v }),
  setStatus: (status) => set({ status }),

  /** 流式输出节流：先缓存到 buffer，定时批量 flush */
  appendOutput: (line) => {
    outputBuffer.push(line)
    scheduleOutputFlush()
  },

  /** 消息容量限制：超出 MAX_MESSAGES 时移除最早的 */
  appendMessage: (message) => {
    const id = `msg-${crypto.randomUUID()}`
    set((state) => {
      let messages = [...state.messages, { ...message, id, timestamp: Date.now() }]
      if (messages.length > MAX_MESSAGES) {
        messages = messages.slice(messages.length - MAX_MESSAGES)
      }
      return { messages }
    })
    return id
  },

  appendCodexMessage: (message) => {
    set((state) => {
      // 已有同 id(重复投递 / 重载后再次收到)则不再插入
      if (state.messages.some((m) => m.id === message.id)) return {}
      let messages = [...state.messages, message]
      if (messages.length > MAX_MESSAGES) {
        messages = messages.slice(messages.length - MAX_MESSAGES)
      }
      return { messages }
    })
    return message.id
  },

  updateMessageKind: (id, kind) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, kind } : m)),
    })),
  setExitCode: (code) => set({ exitCode: code }),
  setThreadId: (id) => set({ threadId: id }),
  setUsage: (usage) => set({ usage }),
  setPendingRunId: (id) => set({ pendingRunId: id }),
  setLiveTurnId: (id) => set({ liveTurnId: id }),
  setRunStartedAt: (ts) => set({ runStartedAt: ts }),
  setRunWorkdir: (w) => set({ runWorkdir: w }),
  markFileChangesSeen: (keys) =>
    set((state) => ({
      seenFileChanges: [...state.seenFileChanges, ...keys],
    })),
  setBaselineFileChanges: (changes) => set({ baselineFileChanges: changes }),
  upsertRunningCommand: (cmd) =>
    set((state) => {
      const exists = state.runningCommands.some((c) => c.id === cmd.id)
      return {
        runningCommands: exists
          ? state.runningCommands.map((c) => (c.id === cmd.id ? cmd : c))
          : [...state.runningCommands, cmd],
      }
    }),
  removeRunningCommand: (id) =>
    set((state) => ({
      runningCommands: state.runningCommands.filter((c) => c.id !== id),
    })),
  setRunningCommands: (cmds) => set({ runningCommands: cmds }),
  setApproval: (approval) => set({ approval }),

  markItemProcessed: (id) => {
    const s = get()
    if (s.processedItemIds.includes(id)) return false
    set((state) => ({ processedItemIds: [...state.processedItemIds, id] }))
    return true
  },
  // 每个 run 时 item id 从 item_0 重新计数，跨 run 必须清空；否则 resume 的新输出被误删
  clearProcessedItems: () => set({ processedItemIds: [] }),
  reset: () =>
    set({
      status: 'idle',
      output: [],
      messages: [],
      exitCode: null,
      threadId: null,
      usage: null,
      pendingRunId: null,
      runningCommands: [],
      approval: null,
      live: null,
      processedItemIds: [],
      lineId: 0,
      runStartedAt: null,
      runWorkdir: null,
      seenFileChanges: [],
      baselineFileChanges: [],
      livePlan: null,
      turns: [],
      turnsCursor: null,
    }),
  setCurrentSessionId: (id) => set({ currentSessionId: id }),
  loadThread: (data) =>
    set({
      status: 'idle',
      output: [],
      messages: data.messages,
      turns: data.turns,
      turnsCursor: data.cursor,
      exitCode: null,
      threadId: data.threadId,
      usage: null,
      pendingRunId: null,
      runningCommands: [],
      approval: null,
      live: null,
      processedItemIds: [],
      runStartedAt: null,
      runWorkdir: null,
      // 重载后 codex 侧的 item 全部重新出现,重置「已展示过的文件变更」避免误抑制
      seenFileChanges: [],
      baselineFileChanges: [],
      livePlan: null,
    }),
  prependTurns: (data) =>
    set((state) => {
      let messages = [...data.messages, ...state.messages]
      if (messages.length > MAX_MESSAGES) {
        messages = messages.slice(messages.length - MAX_MESSAGES)
      }
      return {
        messages,
        turns: [...data.turns, ...state.turns],
        turnsCursor: data.cursor,
      }
    }),
  loadSession: (data) =>
    set({
      status: 'idle',
      output: [],
      messages: data.messages,
      exitCode: null,
      threadId: data.threadId,
      usage: null,
      pendingRunId: null,
      runningCommands: [],
      approval: null,
      live: null,
      processedItemIds: [],
      runStartedAt: null,
      runWorkdir: null,
      seenFileChanges: [],
      baselineFileChanges: [],
      livePlan: null,
    }),
  flushOutputBuffer,
}))

if (typeof window !== 'undefined') {
  const cleanup = () => {
    if (outputFlushTimer) {
      clearTimeout(outputFlushTimer)
      outputFlushTimer = null
    }
  }
  window.addEventListener('beforeunload', cleanup)
  // Tauri dev 热重载时也会触发 pagehide,加上避免 HMR 期间残留
  window.addEventListener('pagehide', cleanup)
}

export { useCodexStore }
