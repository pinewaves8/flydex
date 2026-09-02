import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Clock,
  Cpu,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect } from 'react'

import { McpSettings } from '@/features/mcp/McpSettings'
import { ModelSettings } from '@/features/model/ModelSettings'
import { SkillSettings } from '@/features/skills/SkillSettings'
import { useSecurityStore } from '@/stores/useSecurityStore'
import { useUIStore } from '@/stores/useUIStore'
import { APPROVAL_POLICIES, SANDBOX_MODES } from '@/types/security'

function formatTime(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(ts)
  }
}

export function SettingsPanel() {
  const config = useSecurityStore((s) => s.config)
  const load = useSecurityStore((s) => s.load)
  const setSandboxMode = useSecurityStore((s) => s.setSandboxMode)
  const setApprovalPolicy = useSecurityStore((s) => s.setApprovalPolicy)
  const clearHistory = useSecurityStore((s) => s.clearHistory)
  const setCurrentView = useUIStore((s) => s.setCurrentView)
  const settingsTab = useUIStore((s) => s.settingsTab)
  const openSettings = useUIStore((s) => s.openSettings)

  useEffect(() => {
    void load()
  }, [load])

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载安全配置…
      </div>
    )
  }

  const handleSandbox = async (mode: (typeof SANDBOX_MODES)[number]['value']) => {
    if (mode === 'danger-full-access') {
      const ok = window.confirm(
        '⚠️ 切换到「完全访问」？\n\nAI 将以你的真实权限运行，可读写任意文件并执行任意命令。\n\n此操作不可撤销，建议仅在可信环境中使用。',
      )
      if (!ok) return
    }
    await setSandboxMode(mode)
  }

  const handleApproval = async (policy: (typeof APPROVAL_POLICIES)[number]['value']) => {
    if (policy === 'never') {
      const ok = window.confirm(
        '⚠️ 切换到「自动放行」？\n\nAI 将不询问任何操作、全自动执行，包括写入和命令。\n\n此操作不可撤销，建议仅在可信环境中使用。',
      )
      if (!ok) return
    }
    await setApprovalPolicy(policy)
  }

  const handleClearHistory = () => {
    const ok = window.confirm('确定清空全部审批历史记录吗？')
    if (!ok) return
    void clearHistory()
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <div className="flex items-center justify-between">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck className="h-5 w-5 text-primary" />
              设置
            </h1>
            <button
              onClick={() => setCurrentView('codex')}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              完成
            </button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            管理模型供应商与 Flydex 运行 Codex 时的沙箱级别、审批策略。所有更改即时保存并生效。
          </p>
          {/* Tab 导航 */}
          <div className="mt-4 flex gap-1 border-b border-border">
            <button
              onClick={() => openSettings('security')}
              className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors ${
                settingsTab === 'security'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              沙箱与权限
            </button>
            <button
              onClick={() => openSettings('model')}
              className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors ${
                settingsTab === 'model'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Cpu className="h-4 w-4" />
              模型配置
            </button>
            <button
              onClick={() => openSettings('mcp')}
              className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors ${
                settingsTab === 'mcp'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Boxes className="h-4 w-4" />
              MCP 服务
            </button>
            <button
              onClick={() => openSettings('skills')}
              className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors ${
                settingsTab === 'skills'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Sparkles className="h-4 w-4" />
              Skills
            </button>
          </div>
        </div>

        {/* 沙箱与权限 tab */}
        {settingsTab === 'security' ? (
          <>
            {/* 沙箱模式 */}
            <section>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                沙箱模式
                <span className="ml-2 text-xs opacity-60">（AI 对文件系统的访问范围）</span>
              </h2>
              <div className="grid grid-cols-3 gap-3">
                {SANDBOX_MODES.map((m) => {
                  const active = config.sandbox_mode === m.value
                  return (
                    <button
                      key={m.value}
                      onClick={() => void handleSandbox(m.value)}
                      className={`rounded-lg border p-4 text-left transition-colors ${
                        active
                          ? 'border-primary bg-primary/10 ring-1 ring-primary'
                          : 'border-border bg-card hover:border-primary/50'
                      }`}
                    >
                      <div className="mb-2 text-xl">{m.icon}</div>
                      <div className="mb-1 text-sm font-medium">{m.label}</div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{m.desc}</p>
                      {active && (
                        <div className="mt-2 text-xs font-medium text-primary">当前启用</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </section>

            {/* 审批策略 */}
            <section>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                审批策略
                <span className="ml-2 text-xs opacity-60">（何时需要你确认 AI 的操作）</span>
              </h2>
              <div className="grid grid-cols-3 gap-3">
                {APPROVAL_POLICIES.map((p) => {
                  const active = config.approval_policy === p.value
                  return (
                    <button
                      key={p.value}
                      onClick={() => void handleApproval(p.value)}
                      className={`rounded-lg border p-4 text-left transition-colors ${
                        active
                          ? 'border-primary bg-primary/10 ring-1 ring-primary'
                          : 'border-border bg-card hover:border-primary/50'
                      }`}
                    >
                      <div className="mb-2 text-xl">{p.icon}</div>
                      <div className="mb-1 text-sm font-medium">{p.label}</div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{p.desc}</p>
                      {active && (
                        <div className="mt-2 text-xs font-medium text-primary">当前启用</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </section>

            {/* 审批历史 */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  审批历史
                  <span className="text-xs opacity-60">（最近 {config.history.length} 条）</span>
                </h2>
                {config.history.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                  >
                    <Trash2 className="h-3 w-3" />
                    清空
                  </button>
                )}
              </div>
              {config.history.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  暂无审批记录。当 AI 请求确认操作时，记录会显示在这里。
                </div>
              ) : (
                <div className="divide-y divide-border rounded-lg border border-border">
                  {config.history
                    .slice()
                    .reverse()
                    .map((rec) => (
                      <div key={rec.id} className="flex items-start gap-3 px-4 py-3">
                        {rec.approved ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                        ) : (
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="break-all font-mono text-xs text-foreground">
                            {rec.command}
                          </div>
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            {formatTime(rec.timestamp)} · {rec.approved ? '已允许' : '已拒绝'}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </section>
          </>
        ) : settingsTab === 'model' ? (
          /* 模型配置 tab */
          <ModelSettings />
        ) : settingsTab === 'mcp' ? (
          /* MCP tab */
          <McpSettings />
        ) : settingsTab === 'skills' ? (
          /* Skills tab */
          <SkillSettings />
        ) : null}
      </div>
    </div>
  )
}
