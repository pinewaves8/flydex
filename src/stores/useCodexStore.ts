import { create } from 'zustand'

import type { CodexOutputLine, CodexStatus } from '@/types/codex'
import type { CodexMessage, CodexUsage } from '@/types/codexJson'

/** 待审批的操作（由 codex approval_request 触发） */
export interface CodexApproval {
  id: string
  command?: string
  description?: string
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
  setStatus: (status: CodexStatus) => void
  appendOutput: (line: Omit<CodexOutputLine, 'id'>) => void
  appendMessage: (message: Omit<CodexMessage, 'id' | 'timestamp'>) => string
  markItemProcessed: (id: string) => boolean
  clearProcessedItems: () => void
  setExitCode: (code: number | null) => void
  setThreadId: (id: string | null) => void
  setUsage: (usage: CodexUsage | null) => void
  setPendingRunId: (id: string | null) => void
  upsertRunningCommand: (cmd: CodexRunningCommand) => void
  removeRunningCommand: (id: string) => void
  setRunningCommands: (cmds: CodexRunningCommand[]) => void
  setApproval: (approval: CodexApproval | null) => void
  setStreaming: (streaming: CodexStreaming | null) => void
  advanceStream: (count: number) => void
  reset: () => void
  /** 加载会话数据（切换会话时用） */
  loadSession: (data: { messages: CodexMessage[]; threadId: string | null }) => void
}

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
    }))
    return id
  },
  setExitCode: (code) => set({ exitCode: code }),
  setThreadId: (id) => set({ threadId: id }),
  setUsage: (usage) => set({ usage }),
  setPendingRunId: (id) => set({ pendingRunId: id }),
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
      streaming: null,
      processedItemIds: [],
    }),
}))
