import { FolderOpen, Sparkles } from 'lucide-react'

import { useWorkspaceStore } from '@/stores/useWorkspaceStore'

export function TitleBar() {
  const cwd = useWorkspaceStore((s) => s.cwd)
  const openFolder = useWorkspaceStore((s) => s.openFolder)

  return (
    <header className="flex h-10 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Flydex</span>
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          v0.1.0
        </span>
      </div>

      {/* 全局工作目录选择器 */}
      <button
        onClick={() => void openFolder()}
        className="group flex min-w-0 max-w-[50vw] items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        title={`当前工作目录：${cwd}\n点击切换目录（Codex/Terminal/Git/Projects 将同步）`}
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono">{cwd}</span>
        <span className="shrink-0 text-[10px] opacity-60">▾</span>
      </button>
    </header>
  )
}
