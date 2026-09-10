import { useEffect, useRef, useState } from 'react'

interface ListNavigationOptions<T> {
  /** 当前候选列表(每次渲染可能是新数组,故不参与 effect 依赖) */
  items: T[]
  /** 列表内容变化的标识(如 query 字符串);变化时高亮回到第一项 */
  resetKey: string
  /** Enter 选中 */
  onSelect: (item: T, index: number) => void
  /** Esc 关闭;Enter 无匹配时也会调用 */
  onClose: () => void
  /**
   * 是否接管键盘。默认 true。
   * 对「常驻挂载、用 open 控制显隐」的浮层(SearchDialog)必须传 open,
   * 否则浮层关闭时仍会全局拦截 ↑↓/Enter/Esc。
   */
  enabled?: boolean
}

/**
 * 浮层列表的键盘导航(CommandPalette / FileMention / SearchDialog 共用)
 *
 * - ↑↓ 移动高亮,Enter 选中,Esc 关闭(捕获阶段外的 window 监听,不依赖 React 事件冒泡)
 * - 高亮项自动 `scrollIntoView`
 *
 * 实现要点:最新的 items / 回调放进 ref,window 监听只注册一次 ——
 * 避免每次渲染(含每次按键重建的过滤数组)都注销/重挂监听器。
 */
export function useListNavigation<T>({
  items,
  resetKey,
  onSelect,
  onClose,
  enabled = true,
}: ListNavigationOptions<T>) {
  const [highlightIdx, setHighlightIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // 用 ref 持有最新值,使 keydown 监听可以只挂载一次
  const latest = useRef({ items, onSelect, onClose })
  latest.current = { items, onSelect, onClose }
  // 高亮下标也用 ref 镜像,供只挂载一次的监听器读取(避免陈旧闭包,也避免在 setState 里做副作用)
  const idxRef = useRef(highlightIdx)
  idxRef.current = highlightIdx

  // 查询词变化 → 高亮回到第一项
  useEffect(() => {
    setHighlightIdx(0)
  }, [resetKey])

  // 高亮项滚动到可视区
  useEffect(() => {
    const item = listRef.current?.querySelector(`[data-idx="${highlightIdx}"]`)
    ;(item as HTMLElement | null)?.scrollIntoView({ block: 'nearest' })
  }, [highlightIdx])

  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter' && e.key !== 'Escape') {
        return
      }
      e.preventDefault()
      const { items: list, onSelect: select, onClose: close } = latest.current
      if (e.key === 'ArrowDown') {
        setHighlightIdx((idx) => Math.min(idx + 1, list.length - 1))
      } else if (e.key === 'ArrowUp') {
        setHighlightIdx((idx) => Math.max(idx - 1, 0))
      } else if (e.key === 'Enter') {
        const item = list[idxRef.current]
        if (item) select(item, idxRef.current)
        else close()
      } else {
        close()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled])

  return { highlightIdx, setHighlightIdx, listRef }
}
