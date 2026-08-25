import { useEffect } from 'react'

type ShortcutHandler = (e: KeyboardEvent) => void

interface ShortcutConfig {
  key: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
  handler: ShortcutHandler
}

/** 快捷键监听 hook */
export function useShortcut(config: ShortcutConfig) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== config.key.toLowerCase()) return
      if (config.ctrl && !e.ctrlKey) return
      if (config.meta && !e.metaKey) return
      if (config.shift && !e.shiftKey) return
      if (config.alt && !e.altKey) return
      config.handler(e)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [config])
}
