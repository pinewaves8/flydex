import {
  Brain,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Wand2,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { memoryService } from '@/services/memoryService'
import { validateSkillContent, type ValidationReport } from '@/services/skillService'
import { useSkillsStore } from '@/stores/useSkillsStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'

const SOURCE_LABEL: Record<string, { label: string; color: string }> = {
  builtin: { label: '内置', color: 'border-green-500/30 bg-green-500/10 text-green-400' },
  project: { label: '项目', color: 'border-blue-500/30 bg-blue-500/10 text-blue-400' },
  mcp: { label: 'MCP', color: 'border-sky-500/30 bg-sky-500/10 text-sky-400' },
}

/** 新技能模板：frontmatter + 可复现规则 */
const SKILL_TEMPLATE = `---
name: my-skill
description: 描述这个技能解决什么问题、何时使用（必填）
short-description: 简短描述
triggers:
  - 触发词1
  - 触发词2
---

# 技能名

## 规则
1. 可复现步骤一
2. 可复现步骤二

## 示例
\`\`\`
具体命令或示例（可复现性校验会检查步骤/代码结构）
\`\`\`
`

function ValidationBadge({ report }: { report: ValidationReport | null }) {
  if (!report) return null
  if (report.ok) {
    return (
      <div className="flex items-start gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 px-2 py-1.5 text-xs text-green-400">
        <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>校验通过，可入库保存。</span>
        {report.warnings.length > 0 && (
          <ul className="list-inside list-disc text-green-300/80">
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }
  return (
    <div className="flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-400">
      <XCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      <ul className="list-inside list-disc">
        {report.errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </div>
  )
}

export function SkillSettings() {
  const skills = useSkillsStore((s) => s.skills)
  const loading = useSkillsStore((s) => s.loading)
  const load = useSkillsStore((s) => s.load)
  const toggle = useSkillsStore((s) => s.toggle)
  const createSkill = useSkillsStore((s) => s.createSkill)
  const deleteSkill = useSkillsStore((s) => s.deleteSkill)
  const workspaceCwd = useWorkspaceStore((s) => s.cwd)

  const [filter, setFilter] = useState('')
  const [filterSource, setFilterSource] = useState<string>('all')
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formContent, setFormContent] = useState('')
  const [validation, setValidation] = useState<ValidationReport | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [remember, setRemember] = useState<Record<string, boolean>>({})

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

  const fillTemplate = () => {
    setFormContent(SKILL_TEMPLATE)
    setValidation(null)
    setFormError(null)
  }

  const handleValidate = async () => {
    setFormError(null)
    try {
      setValidation(await validateSkillContent(formContent))
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleSave = async () => {
    if (!workspaceCwd) {
      setFormError('未设置工作目录，无法保存技能')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await createSkill(workspaceCwd, formName.trim(), formContent)
      setShowForm(false)
      setFormName('')
      setFormContent('')
      setValidation(null)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (name: string) => {
    if (!workspaceCwd) return
    try {
      await deleteSkill(workspaceCwd, name)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleRemember = async (name: string, description: string) => {
    if (!workspaceCwd) return
    setRemember((m) => ({ ...m, [name]: true }))
    try {
      await memoryService.appendProject(
        workspaceCwd,
        'skills',
        `[${name}] ${description}`,
        'skill-settings',
      )
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setTimeout(() => setRemember((m) => ({ ...m, [name]: false })), 1600)
    }
  }

  return (
    <div className="space-y-6">
      {/* 顶部提示 */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
        Skills 会向 Codex 注入系统提示词，让 AI 知道可用能力和使用场景。项目技能存放在
        <code className="mx-1 rounded border border-primary/30 bg-primary/10 px-1 font-mono">
          .codex/skills/*/SKILL.md
        </code>
        ，创建时经校验门禁，保存/删除均留备份可回滚。
      </div>

      {/* 新建技能 */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">沉淀技能</span>
          <div className="flex items-center gap-2">
            {showForm && (
              <>
                <button
                  onClick={fillTemplate}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                >
                  <Wand2 className="h-3 w-3" />
                  填充模板
                </button>
                <button
                  onClick={handleValidate}
                  className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                >
                  校验
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !workspaceCwd}
                  className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  保存技能
                </button>
              </>
            )}
            <button
              onClick={() => {
                setShowForm((v) => !v)
                setValidation(null)
                setFormError(null)
              }}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
            >
              <Plus className="h-3 w-3" />
              {showForm ? '收起' : '新建'}
            </button>
          </div>
        </div>

        {showForm && (
          <div className="mt-3 space-y-2">
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">
                技能名（将创建 .codex/skills/&lt;技能名&gt;/SKILL.md）
              </label>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="my-skill"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">
                SKILL.md 内容（含 frontmatter + 可复现步骤）
              </label>
              <textarea
                value={formContent}
                onChange={(e) => {
                  setFormContent(e.target.value)
                  setValidation(null)
                }}
                rows={12}
                spellCheck={false}
                placeholder={'---\nname: ...\ndescription: ...\n---\n\n# 规则\n1. ...'}
                className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary"
              />
            </div>
            {!workspaceCwd && (
              <div className="text-[11px] text-destructive">未设置工作目录，无法保存技能。</div>
            )}
            <ValidationBadge report={validation} />
            {formError && <div className="text-[11px] text-destructive">{formError}</div>}
          </div>
        )}
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
              {filter ? '未找到匹配的技能' : '暂无技能。点击「新建」创建并沉淀技能。'}
            </div>
          ) : (
            filtered.map((skill) => {
              const src = SOURCE_LABEL[skill.source] ?? SOURCE_LABEL.builtin
              const isProject = skill.source === 'project'
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

                    {/* 操作区 */}
                    <div className="flex shrink-0 items-center gap-1">
                      {isProject && (
                        <>
                          <button
                            onClick={() => handleRemember(skill.name, skill.description)}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="写入项目记忆"
                          >
                            {remember[skill.name] ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <Brain className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDelete(skill.name)}
                            className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                            title="删除（先备份到 logs/skill-trash/ 可回滚）"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
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
