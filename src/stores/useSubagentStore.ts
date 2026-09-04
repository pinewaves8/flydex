import { create } from 'zustand'

/**
 * 子代理后台状态（7.2.3 Background Agents）：
 * 面板收起后任务继续在后台运行，主会话不受影响；
 * ChatPanel 订阅该 store 显示后台运行数徽章，点击可重新展开面板。
 */
interface SubagentState {
  backgroundRunning: number
  backgroundTotal: number
  setBackground: (running: number, total: number) => void
}

export const useSubagentStore = create<SubagentState>((set) => ({
  backgroundRunning: 0,
  backgroundTotal: 0,
  setBackground: (running, total) => set({ backgroundRunning: running, backgroundTotal: total }),
}))
