import { useEffect } from 'react'

/** 通用事件监听 hook */
export function useEventListener<T extends keyof WindowEventMap>(
  event: T,
  handler: (e: WindowEventMap[T]) => void,
  element?: Window | HTMLElement,
) {
  useEffect(() => {
    const target = element ?? window
    target.addEventListener(event, handler as EventListener)
    return () => target.removeEventListener(event, handler as EventListener)
  }, [event, handler, element])
}
