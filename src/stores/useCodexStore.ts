import { create } from 'zustand'

import { sessionService } from '@/services/sessionService'
import { useProjectStore } from '@/stores/useProjectStore'
import type { CodexOutputLine, CodexStatus } from '@/types/codex'
import type { CodexMessage, CodexFileChange, CodexUsage } from '@/types/codexJson'

/** 待审批的操作（由 codex approval_request 触发） */
export interface CodexApproval {
  id: string
  command?: string
  description?: string
  /** 规则引擎决策：ask=弹审批卡；auto_accept/auto_deny=自动放行/拒绝（仅通知） */
  decision?: string
  reason?: string
}

/** 正在执行的命令（实时命令看板） */
export interface CodexRunningCommand {
  id: string
  command: string
  startedAt: number
}

/** 打字机流式渲染状态 */
export interface CodexStreaming {
  id: string
  full: string
  shown: number
}

/** 计划模式开关的 localStorage key（跨重启保持开关状态） */
const PLAN_MODE_KEY = 'flydex.planMode'

/** 自动保存 debounce 时间（毫秒） */
const AUTOSAVE_DEBOUNCE_MS = 500

interface CodexState {
  status: CodexStatus
  output: CodexOutputLine[]
  messages: CodexMessage[]
  exitCode: number | null
  threadId: string | null
  usage: CodexUsage | null
  /** 当前运行 id（用于审批/停止） */
  pendingRunId: string | null
  /** 正在执行的命令（实时看板） */
  runningCommands: CodexRunningCommand[]
  /** 待审批项 */
  approval: CodexApproval | null
  /** 打字机流式渲染状态（agent_message 逐字显示） */
  streaming: CodexStreaming | null
  /** 已处理的 codex item id（事件级幂等去重，防监听器泄漏导致重复消息） */
  processedItemIds: string[]
  lineId: number
  /** 本轮开始时间戳（用于显示每轮耗时） */
  runStartedAt: number | null
  /** 当前 run 的工作目录（写入后审查兜底：turn 完成时对比 git 工作区） */
  runWorkdir: string | null
  /** 已展示过的文件变更 key（path|kind），避免重复生成文件变更卡片 */
  seenFileChanges: string[]
  /** 本轮开始时的 git 工作区变更快照（用于只展示本轮新增的变更，避免误报历史遗留文件） */
  baselineFileChanges: CodexFileChange[]
  /** 计划模式开关（开启后发送生成计划而非直接执行，批准后再执行） */
  planMode: boolean
  /** 当前会话 id（用于自动保存）；null 表示不保存 */
  currentSessionId: string | null
  /** 是否有待保存的变更 */
  dirty: boolean
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
  /** 标记脏并触发自动保存（手动立即保存） */
  flushAutosave: () => Promise<void>
  /** 加载会话数据（切换会话时用） */
  loadSession: (data: { messages: CodexMessage[]; threadId: string | null }) => void
}

/**
 * 自动保存调度：监听 store 状态变化，debounce 后异步写入磁盘
 *
 * 为什么放这里：避免 ChatPanel 里 load+save的竞态，统一在 store 层管理
 * 为什么用 subscribe：zustand store 不应该依赖 React 副作用
 */
function setupAutosave(): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let saving = false
  let pending = false

  const saveNow = async () => {
    const state = useCodexStore.getState()
    const sid = state.currentSessionId
    if (!sid) {
      console.log('[autosave] skip: no currentSessionId')
      return
    }
    if (saving) {
      pending = true
      return
    }
    saving = true
    try {
      const session = await sessionService.load(sid)
      if (!session) {
        console.log('[autosave] skip: session not found', sid)
        return
      }
      session.messages = state.messages
      session.threadId = state.threadId
      session.updatedAt = Date.now()
      await sessionService.save(session)
      console.log(
        '[autosave] saved',
        sid,
        'messages=',
        state.messages.length,
        'threadId=',
        state.threadId,
      )
      // 通知 project store 刷新列表（更新排序）
      void useProjectStore.getState().loadSessions()
    } catch (e) {
      console.error('[autosave] failed:', e)
    } finally {
      saving = false
      // 如果在等待期间又有变更，再跑一轮
      if (pending) {
        pending = false
        void saveNow()
      }
    }
  }

  useCodexStore.subscribe((state, prev) => {
    if (!state.currentSessionId) {
      console.log('[autosave] subscribe: no currentSessionId')
      return
    }
    if (
      state.messages === prev.messages &&
      state.threadId === prev.threadId &&
      state.dirty === prev.dirty
    ) {
      return
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void saveNow()
    }, AUTOSAVE_DEBOUNCE_MS)
  })
}

// 注意：setupAutosave 在模块初始化时执行一次；它从 store 闭包获取 state
// 由于 store 在 create 之后才存在，subscribe 调用要放到 create 后面

export const useCodexStore = create<CodexState>((set, get) => ({
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
  reviewMode: false,
  setReviewMode: (v) => set({ reviewMode: v }),
  setPlanMode: (v) => {
    try {
      localStorage.setItem(PLAN_MODE_KEY, v ? '1' : '0')
    } catch {
      // localStorage 不可用时仅内存态
    }
    set({ planMode: v })
  },
  setStatus: (status) => set({ status }),
  appendOutput: (line) =>
    set((state) => ({
      output: [...state.output, { ...line, id: state.lineId }],
      lineId: state.lineId + 1,
    })),
  appendMessage: (message) => {
    // 全局唯一 id（uuid），避免 reset 后 messageId 归零导致 key 冲突
    const id = `msg-${crypto.randomUUID()}`
    set((state) => ({
      messages: [...state.messages, { ...message, id, timestamp: Date.now() }],
      dirty: true,
    }))
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
  // 每个 run 内 item id 从 item_0 重新计数，跨 run 必须清空，否则 resume 的新输出被误删
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
    // 立即触发保存（不等 debounce）
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
}))

// 初始化自动保存订阅（模块加载时执行一次）
setupAutosave()
