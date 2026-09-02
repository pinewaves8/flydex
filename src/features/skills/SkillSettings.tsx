import { Loader2, Search, ToggleLeft, ToggleRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useSkillsStore } from '@/stores/useSkillsStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'

const SOURCE_LABEL: Record<string, { label: string; color: string }> = {
  builtin: { label: '内置', color: 'border-green-500/30 bg-green-500/10 text-green-400' },
  project: { label: '项目', color: 'border-blue-500/30 bg-blue-500/10 text-blue-400' },
  mcp: { label: 'MCP', color: 'border-sky-500/30 bg-sky-500/10 text-sky-400' },
}

export function SkillSettings() {
  const skills = useSkillsStore((s) => s.skills)
  const loading = useSkillsStore((s) => s.loading)
  const load = useSkillsStore((s) => s.load)
  const toggle = useSkillsStore((s) => s.toggle)
  const workspaceCwd = useWorkspaceStore((s) => s.cwd)

  const [filter, setFilter] = useState('')
  const [filterSource, setFilterSource] = useState<string>('all')

  useEffect(() => {
    if (workspaceCwd) {
      void load(workspaceCwd)
    }
  }, [workspaceCwd, load])

  const filtered = skills.filter((s) => {
    if (filterSource !== 'all' && s.source !== filterSource) return false
    if (!filter.trim()) return true
    const q = filter.toLowerCase()
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.triggers.some((t) => t.toLowerCase().includes(q))
    )
  })

  return (
    <div className="space-y-6">
      {/* 顶部提示 */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
        Skills 为 Codex 注入系统提示词，让 AI 知道可用能力和使用场景。在输入区键入{' '}
        <kbd className="rounded border border-primary/30 bg-primary/10 px-1 font-mono">/</kbd> 或{' '}
        <kbd className="rounded border border-primary/30 bg-primary/10 px-1 font-mono">
          Ctrl+Shift+P
        </kbd>{' '}
        快速调用技能。
      </div>

      {/* 过滤栏 */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索技能…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
        >
          <option value="all">全部来源</option>
          <option value="builtin">内置</option>
          <option value="project">项目</option>
          <option value="mcp">MCP</option>
        </select>
      </div>

      {/* 加载态 */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载技能…
        </div>
      )}

      {/* 技能列表 */}
      {!loading && (
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {filter
                ? '未找到匹配的技能'
                : '暂无技能。在项目目录下创建 .codex/skills/*/SKILL.md 添加项目技能。'}
            </div>
          ) : (
            filtered.map((skill) => {
              const src = SOURCE_LABEL[skill.source] ?? SOURCE_LABEL.builtin
              return (
                <div
                  key={skill.name}
                  className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/30"
                >
                  <div className="flex items-start gap-3">
                    {/* 图标 */}
                    <span
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-xs font-bold"
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
                        <span className={`rounded border px-1.5 py-px text-[10px] ${src.color}`}>
                          {src.label}
                        </span>
                        {skill.mcpServer && (
                          <span className="rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground">
                            → {skill.mcpServer}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{skill.description}</p>

                      {/* 触发词 */}
                      {skill.triggers.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {skill.triggers.map((t) => (
                            <span
                              key={t}
                              className="rounded border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 开关 */}
                    <button
                      onClick={() => toggle(skill.name)}
                      className={`shrink-0 transition-colors ${
                        skill.enabled ? 'text-primary' : 'text-muted-foreground'
                      }`}
                      title={skill.enabled ? '禁用' : '启用'}
                    >
                      {skill.enabled ? (
                        <ToggleRight className="h-5 w-5" />
                      ) : (
                        <ToggleLeft className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* 统计 */}
      {!loading && skills.length > 0 && (
        <div className="text-center text-[10px] text-muted-foreground">
          共 {skills.length} 个技能，{skills.filter((s) => s.enabled).length} 个已启用
        </div>
      )}
    </div>
  )
}
