import { create } from 'zustand'

import type { CodexOutputLine, CodexStatus } from '@/types/codex'

interface CodexState {
  status: CodexStatus
  output: CodexOutputLine[]
  exitCode: number | null
  lineId: number
  setStatus: (status: CodexStatus) => void
  appendOutput: (line: Omit<CodexOutputLine, 'id'>) => void
  setExitCode: (code: number | null) => void
  reset: () => void
  nextLineId: () => number
}

export const useCodexStore = create<CodexState>((set, get) => ({
  status: 'idle',
  output: [],
  exitCode: null,
  lineId: 0,
  setStatus: (status) => set({ status }),
  appendOutput: (line) =>
    set((state) => ({
      output: [...state.output, { ...line, id: state.lineId }],
      lineId: state.lineId + 1,
    })),
  setExitCode: (code) => set({ exitCode: code }),
  reset: () => set({ status: 'idle', output: [], exitCode: null, lineId: 0 }),
  nextLineId: () => {
    const id = get().lineId
    set((state) => ({ lineId: state.lineId + 1 }))
    return id
  },
}))
