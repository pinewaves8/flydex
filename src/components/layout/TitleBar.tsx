import { FolderOpen, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect } from 'react'

import { useSecurityStore } from '@/stores/useSecurityStore'
import { useUIStore } from '@/stores/useUIStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'
import { approvalLabel, sandboxLabel } from '@/types/security'

export function TitleBar() {
  const cwd = useWorkspaceStore((s) => s.cwd)
  const openFolder = useWorkspaceStore((s) => s.openFolder)
  const securityConfig = useSecurityStore((s) => s.config)
  const loadSecurity = useSecurityStore((s) => s.load)
  const openSettings = useUIStore((s) => s.openSettings)

  // 启动时加载安全配置（顶部状态栏显示）
  useEffect(() => {
    void loadSecurity()
  }, [loadSecurity])

  const isHighRisk =
    securityConfig?.sandbox_mode === 'danger-full-access' ||
    securityConfig?.approval_policy === 'never'

  return (
    <header className="flex h-10 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Flydex</span>
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          v0.1.0
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* 全局工作目录选择器 */}
        <button
          onClick={() => void openFolder()}
          className="group flex min-w-0 max-w-[40vw] items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          title={`当前工作目录：${cwd}\n点击切换目录（Codex/Terminal/Git/Projects 将同步）`}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono">{cwd}</span>
          <span className="shrink-0 text-[10px] opacity-60">▾</span>
        </button>

        {/* 安全状态指示器 */}
        {securityConfig && (
          <button
            onClick={() => openSettings('security')}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
              isHighRisk
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                : 'border-border bg-muted/40 text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            }`}
            title={`沙箱：${sandboxLabel(securityConfig.sandbox_mode)}\n审批：${approvalLabel(
              securityConfig.approval_policy,
            )}\n点击打开安全设置`}
          >
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">
              {sandboxLabel(securityConfig.sandbox_mode)} ·{' '}
              {approvalLabel(securityConfig.approval_policy)}
            </span>
            <span className="sm:hidden">
              {securityConfig.sandbox_mode === 'read-only'
                ? '只读'
                : securityConfig.sandbox_mode === 'workspace-write'
                  ? '工作区'
                  : '完全访问'}
            </span>
          </button>
        )}
      </div>
    </header>
  )
}
