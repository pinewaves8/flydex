import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useSkillsStore } from '@/stores/useSkillsStore'

/**
 * SkillPalette — Command Palette 式技能搜索与执行面板
 *
 * 触发方式：
 * - 输入区键入 `/` 自动弹出（由 ChatPanel 控制）
 * - Ctrl+Shift+P 全局快捷键
 *
 * 交互：
 * - 模糊匹配技能名 + 描述
 * - ↑↓ 选择，Enter 执行，Esc 关闭
 * - 选中后回调 onSelect，由 ChatPanel 处理注入
 */
export function SkillPalette({
  onSelect,
  onClose,
}: {
  onSelect?: (name: string) => void
  onClose?: () => void
}) {
  const skills = useSkillsStore((s) => s.skills)
  const paletteQuery = useSkillsStore((s) => s.paletteQuery)
  const setPaletteQuery = useSkillsStore((s) => s.setPaletteQuery)
  const setPaletteOpen = useSkillsStore((s) => s.setPaletteOpen)
  const search = useSkillsStore((s) => s.search)

  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = search(paletteQuery)

  // 打开时自动聚焦搜索框
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 查询变化时重置选中到第一项
  useEffect(() => {
    setSelectedIndex(0)
  }, [paletteQuery])

  const handleSelect = (name: string) => {
    onSelect?.(name)
    setPaletteOpen(false)
    setPaletteQuery('')
    onClose?.()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex].name)
        }
        break
      case 'Escape':
        e.preventDefault()
        setPaletteOpen(false)
        setPaletteQuery('')
        onClose?.()
        break
    }
  }

  if (!skills.length) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]">
      <div className="w-[520px] max-w-[90vw] overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
        {/* 搜索栏 */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={paletteQuery}
            onChange={(e) => setPaletteQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索技能…"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={() => {
              setPaletteOpen(false)
              setPaletteQuery('')
              onClose?.()
            }}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 结果列表 */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">未找到匹配的技能</div>
          ) : (
            <div className="space-y-0.5">
              {results.map((skill, i) => {
                const sourceLabel =
                  skill.source === 'builtin' ? '内置' : skill.source === 'project' ? '项目' : 'MCP'
                const sourceColor =
                  skill.source === 'builtin'
                    ? 'border-green-500/30 bg-green-500/10 text-green-400'
                    : skill.source === 'project'
                      ? 'border-blue-500/30 bg-blue-500/10 text-blue-400'
                      : 'border-sky-500/30 bg-sky-500/10 text-sky-400'

                return (
                  <button
                    key={skill.name}
                    onClick={() => handleSelect(skill.name)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                      i === selectedIndex
                        ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                        : 'text-foreground hover:bg-accent'
                    }`}
                  >
                    {/* 图标 */}
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold"
                      style={{
                        borderColor: skill.interface?.brandColor ?? 'currentColor',
                        color: skill.interface?.brandColor ?? 'currentColor',
                        backgroundColor: skill.interface?.brandColor
                          ? `${skill.interface.brandColor}15`
                          : undefined,
                      }}
                    >
                      {(skill.interface?.displayName ?? skill.name).slice(0, 2)}
                    </span>

                    {/* 信息 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {skill.interface?.displayName ?? skill.name}
                        </span>
                        <span className={`rounded border px-1 py-px text-[10px] ${sourceColor}`}>
                          {sourceLabel}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {skill.shortDescription ?? skill.description}
                      </div>
                    </div>

                    {/* 触发词提示 */}
                    {skill.triggers.length > 0 && (
                      <div className="hidden shrink-0 gap-1 sm:flex">
                        {skill.triggers.slice(0, 2).map((t) => (
                          <span
                            key={t}
                            className="rounded border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          ↑↓ 导航 · Enter 选择 · Esc 关闭 · 键入过滤
        </div>
      </div>
    </div>
  )
}
