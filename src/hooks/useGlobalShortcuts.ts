import { useEffect } from 'react'

import { useUIStore } from '@/stores/useUIStore'

/**
 * 应用内全局快捷键
 *
 * 监听 window keydown，在任意视图下生效（无需聚焦输入框）。
 * 当焦点在输入框/文本域/终端等可输入元素时跳过，避免与打字冲突。
 */
export function useGlobalShortcuts() {
  useEffect(() => {
    const isEditable = (el: Element | null): boolean => {
      if (!el) return false
      const tag = el.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
      if ((el as HTMLElement).isContentEditable) return true
      return false
    }

    const handler = (e: KeyboardEvent) => {
      // 焦点在可输入元素时放行（终端面板内部有自己的按键处理）
      const target = e.target as Element | null
      if (isEditable(target)) return

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
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
