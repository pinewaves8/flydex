import { useEffect } from 'react'

import { useUIStore } from '@/stores/useUIStore'

/**
 * 应用内全局快捷键
 *
 * 在 window 捕获阶段监听 keydown，任意视图/任意焦点下生效。
 * 使用捕获阶段（capture）是为了保证事件先于 xterm 终端输入框等
 * 内层元素的 keydown 处理，避免被拦截或 stopPropagation。
 * Ctrl+Shift+N / Ctrl+Shift+K 不是常规打字组合，无需担心误触。
 */
export function useGlobalShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Shift+N：切换/打开内置终端
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        useUIStore.getState().setCurrentView('terminal')
        return
      }
      // Ctrl+Shift+K：切回 Codex 对话
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useUIStore.getState().setCurrentView('codex')
        return
      }
      // Ctrl+R：全局对话搜索（对齐 Claude Code）
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        const ui = useUIStore.getState()
        ui.setSearchOpen(!ui.searchOpen)
        return
      }
    }

    // 捕获阶段监听：先于目标元素（如 xterm 的输入 textarea）的 keydown 处理执行
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])
}
