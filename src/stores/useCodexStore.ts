import { create } from 'zustand'

import { sessionService } from '@/services/sessionService'
import { useProjectStore } from '@/stores/useProjectStore'
import type { CodexOutputLine, CodexStatus } from '@/types/codex'
import type { CodexMessage, CodexFileChange, CodexUsage } from '@/types/codexJson'

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

/** 打字机流式覆写状态（agent_message 逐字显示）*/
export interface CodexStreaming {
  id: string
  full: string
  shown: number
}

/** 计划模式开启的 localStorage key（非法重启保持开启状态） */
const PLAN_MODE_KEY = 'flydex.planMode'

/** 自动保存 debounce 时间（毫秒） */
const AUTOSAVE_DEBOUNCE_MS = 2000

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
  /** 正在执行的命令（实时面板）*/
  runningCommands: CodexRunningCommand[]
  /** 待审批项 */
  approval: CodexApproval | null
  /** 打字机流式覆写状态（agent_message 逐字显示）*/
  streaming: CodexStreaming | null
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
  /** 是否有待保存的变更*/
  dirty: boolean
  /** 待写入输入框的命令前缀(由 SkillPalette 等外部触发);InputBox 监听后清空 */
  pendingCommand: string | null
  setPendingCommand: (cmd: string | null) => void
  setPlanMode: (v: boolean) => void
  reviewMode: boolean
  setReviewMode: (v: boolean) => void
  setStatus: (status: CodexStatus) => void
  appendOutput: (line: Omit<CodexOutputLine, 'id'>) => void
  appendMessage: (message: Omit<CodexMessage, 'id' | 'timestamp'>) => string
  updateMessageKind: (id: string, kind: CodexMessage['kind']) => void
  markItemProcessed: (id: string) => boolean
  clearProcessedItems: () => void
  setExitCode: (code: number | null) => void
  setThreadId: (id: string | null) => void
  setUsage: (usage: CodexUsage | null) => void
  setPendingRunId: (id: string | null) => void
  setRunStartedAt: (ts: number | null) => void
  setRunWorkdir: (w: string | null) => void
  markFileChangesSeen: (keys: string[]) => void
  setBaselineFileChanges: (changes: CodexFileChange[]) => void
  upsertRunningCommand: (cmd: CodexRunningCommand) => void
  removeRunningCommand: (id: string) => void
  setRunningCommands: (cmds: CodexRunningCommand[]) => void
  setApproval: (approval: CodexApproval | null) => void
  setStreaming: (streaming: CodexStreaming | null) => void
  advanceStream: (count: number) => void
  reset: () => void
  /** 设置当前会话 id（启用自动保存）；传 null 关闭自动保存 */
  setCurrentSessionId: (id: string | null) => void
  /** 标记脏并触发自动保存（手点立及保存） */
  flushAutosave: () => Promise<void>
  /** 加载会话数据（切换会话时用）*/
  loadSession: (data: { messages: CodexMessage[]; threadId: string | null }) => void
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

/**
 * 自动保存调度：监听 store 状态变化，debounce 后异步写入磁盘
 *
 * 为什么放这里：避免 ChatPanel 读 load+save的竞态，统一在 store 层调度
 * 为什么用 subscribe：zustand store 不应该依赖 React 的批量更新机制
 */
function setupAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastMessages: CodexMessage[] | null = null
  let lastThreadId: string | null = null
  let cancelled = false

  const unsub = useCodexStore.subscribe((state, prevState) => {
    if (cancelled) return
    // 只关心 dirty 标志和 messages/threadId
    if (!state.dirty && !prevState.dirty) return
    if (state.currentSessionId === null) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      if (cancelled) return
      const s = useCodexStore.getState()
      if (!s.dirty || !s.currentSessionId) return
      // 跳过无变化
      if (s.messages === lastMessages && s.threadId === lastThreadId && s.currentSessionId) {
        return
      }
      lastMessages = s.messages
      lastThreadId = s.threadId
      try {
        const session = await sessionService.load(s.currentSessionId)
        if (!session) return
        session.messages = s.messages
        session.threadId = s.threadId
        session.updatedAt = Date.now()
        await sessionService.save(session)
        useCodexStore.setState({ dirty: false })
        void useProjectStore.getState().loadSessions()
      } catch (e) {
        console.error('[autosave] failed:', e)
      }
    }, AUTOSAVE_DEBOUNCE_MS)
  })

  // 返回 unsub:取消订阅 + 清掉 pending timer + 标记 cancelled 防止异步 setState 触发
  return () => {
    cancelled = true
    unsub()
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
}

const useCodexStore = create<CodexState>((set, get) => ({
  status: 'idle',
  output: [],
  messages: [],
  exitCode: null,
  threadId: null,
  usage: null,
  pendingRunId: null,
  runningCommands: [],
  approval: null,
  streaming: null,
  processedItemIds: [],
  lineId: 0,
  runStartedAt: null,
  runWorkdir: null,
  seenFileChanges: [],
  baselineFileChanges: [],
  planMode: (() => {
    try {
      return localStorage.getItem(PLAN_MODE_KEY) === '1'
    } catch {
      return false
    }
  })(),
  currentSessionId: null,
  dirty: false,
  pendingCommand: null,
  reviewMode: false,
  setReviewMode: (v) => set({ reviewMode: v }),
  setPendingCommand: (cmd) => set({ pendingCommand: cmd }),
  setPlanMode: (v) => {
    try {
      localStorage.setItem(PLAN_MODE_KEY, v ? '1' : '0')
    } catch {
      // localStorage 不可用时忽略
    }
    set({ planMode: v })
  },
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
      return { messages, dirty: true }
    })
    return id
  },

  updateMessageKind: (id, kind) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, kind } : m)),
      dirty: true,
    })),
  setExitCode: (code) => set({ exitCode: code }),
  setThreadId: (id) => set({ threadId: id, dirty: true }),
  setUsage: (usage) => set({ usage }),
  setPendingRunId: (id) => set({ pendingRunId: id }),
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
  setStreaming: (streaming) => set({ streaming }),
  markItemProcessed: (id) => {
    const s = get()
    if (s.processedItemIds.includes(id)) return false
    set((state) => ({ processedItemIds: [...state.processedItemIds, id] }))
    return true
  },
  // 每个 run 时 item id 从 item_0 重新计数，跨 run 必须清空；否则 resume 的新输出被误删
  clearProcessedItems: () => set({ processedItemIds: [] }),
  advanceStream: (count) =>
    set((state) => {
      if (!state.streaming) return state
      const shown = Math.min(state.streaming.full.length, state.streaming.shown + count)
      const done = shown >= state.streaming.full.length
      return done ? { streaming: null } : { streaming: { ...state.streaming, shown } }
    }),
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
      streaming: null,
      processedItemIds: [],
      lineId: 0,
      runStartedAt: null,
      runWorkdir: null,
      seenFileChanges: [],
      baselineFileChanges: [],
      dirty: false,
    }),
  setCurrentSessionId: (id) => set({ currentSessionId: id, dirty: false }),
  flushAutosave: async () => {
    // 立即触发保存（不缩 debounce）
    const state = get()
    const sid = state.currentSessionId
    if (!sid) return
    try {
      const session = await sessionService.load(sid)
      if (!session) return
      session.messages = state.messages
      session.threadId = state.threadId
      session.updatedAt = Date.now()
      await sessionService.save(session)
      set({ dirty: false })
      void useProjectStore.getState().loadSessions()
    } catch (e) {
      console.error('[flushAutosave] failed:', e)
    }
  },
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
      streaming: null,
      processedItemIds: [],
      runStartedAt: null,
      runWorkdir: null,
      seenFileChanges: [],
      baselineFileChanges: [],
      dirty: false,
    }),
  flushOutputBuffer,
}))

// 初始化自动保存调度（必须在 useCodexStore 创建之后调用，
// 否则 setupAutosave 内部访问 useCodexStore.subscribe 会触发 TDZ）
const disposeAutosave = setupAutosave()

// 页面/窗口卸载时清理:取消订阅 + 清掉 pending timer,防止异步操作触发
// "setState on unmounted component" 警告或内存泄漏
if (typeof window !== 'undefined') {
  const cleanup = () => {
    disposeAutosave()
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
