import { create } from 'zustand'

import type { CodexOutputLine, CodexStatus } from '@/types/codex'
import type { CodexMessage, CodexUsage } from '@/types/codexJson'

interface CodexState {
  status: CodexStatus
  output: CodexOutputLine[]
  messages: CodexMessage[]
  exitCode: number | null
  threadId: string | null
  usage: CodexUsage | null
  lineId: number
  messageId: number
  setStatus: (status: CodexStatus) => void
  appendOutput: (line: Omit<CodexOutputLine, 'id'>) => void
  appendMessage: (message: Omit<CodexMessage, 'id' | 'timestamp'>) => void
  setExitCode: (code: number | null) => void
  setThreadId: (id: string | null) => void
  setUsage: (usage: CodexUsage | null) => void
  reset: () => void
  /** 加载会话数据（切换会话时用） */
  loadSession: (data: { messages: CodexMessage[]; threadId: string | null }) => void
  nextLineId: () => number
  nextMessageId: () => number
}

export const useCodexStore = create<CodexState>((set, get) => ({
  status: 'idle',
  output: [],
  messages: [],
  exitCode: null,
  threadId: null,
  usage: null,
  lineId: 0,
  messageId: 0,
  setStatus: (status) => set({ status }),
  appendOutput: (line) =>
    set((state) => ({
      output: [...state.output, { ...line, id: state.lineId }],
      lineId: state.lineId + 1,
    })),
  appendMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { ...message, id: `msg-${state.messageId}`, timestamp: Date.now() },
      ],
      messageId: state.messageId + 1,
    })),
  setExitCode: (code) => set({ exitCode: code }),
  setThreadId: (id) => set({ threadId: id }),
  setUsage: (usage) => set({ usage }),
  reset: () =>
    set({
      status: 'idle',
      output: [],
      messages: [],
      exitCode: null,
      threadId: null,
      usage: null,
      lineId: 0,
      messageId: 0,
    }),
  loadSession: (data) =>
    set({
      status: 'idle',
      output: [],
      messages: data.messages,
      exitCode: null,
      threadId: data.threadId,
      usage: null,
    }),
  nextLineId: () => {
    const id = get().lineId
    set((state) => ({ lineId: state.lineId + 1 }))
    return id
  },
  nextMessageId: () => {
    const id = get().messageId
    set((state) => ({ messageId: state.messageId + 1 }))
    return id
  },
}))
