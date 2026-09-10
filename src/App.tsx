import { useEffect, useState } from 'react'

import { Sidebar } from '@/components/layout/Sidebar'
import { TitleBar } from '@/components/layout/TitleBar'
import { ChatPanel } from '@/features/codex'
import { FilesView } from '@/features/files/FilesView'
import { GitPanel } from '@/features/git'
import { ProjectsPanel } from '@/features/project'
import { SearchDialog } from '@/features/search/SearchDialog'
import { SettingsPanel } from '@/features/security/SettingsPanel'
import { TerminalPanel } from '@/features/terminal'
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts'
import { useProjectStore } from '@/stores/useProjectStore'
import { applyTheme, useThemeStore } from '@/stores/useThemeStore'
import { useUIStore } from '@/stores/useUIStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'

function App() {
  const { currentView } = useUIStore()
  const loadProjects = useProjectStore((s) => s.loadProjects)

  // 应用内全局快捷键（Ctrl+Shift+N 终端 / Ctrl+Shift+K 对话）
  useGlobalShortcuts()

  // Ctrl+R 全局对话搜索(快捷键在 useGlobalShortcuts 统一注册,开合状态在 useUIStore)
  const searchOpen = useUIStore((s) => s.searchOpen)
  const setSearchOpen = useUIStore((s) => s.setSearchOpen)
  // 项目归属同步的非致命问题(codex 不可用等)—— 必须可见,不能只在 console
  const projectSyncWarnings = useProjectStore((s) => s.projectSyncWarnings)
  // 按「内容签名」记录已关闭的那一条:否则用户关过一次后,后续**新的**警告
  // 也会被连坐隐藏 —— 那就成了静默失败(第三原则)
  const warnSig = projectSyncWarnings.join(';')
  const [dismissedWarnSig, setDismissedWarnSig] = useState<string | null>(null)
  const setCurrentView = useUIStore((s) => s.setCurrentView)
  const revealSearchHit = useProjectStore((s) => s.revealSearchHit)

  // 应用启动时加载项目和会话列表 —— 用 workspace cwd 作为 source of truth,
  // 保证 cwd / project / session 三者始终同步
  useEffect(() => {
    ;(async () => {
      const cwd = useWorkspaceStore.getState().cwd
      await loadProjects(cwd)
      // 防御:如果 cwd 没有对应项目(例如手动建了新文件夹),
      // 把 cwd 同步到当前项目的 path,避免出现项目 A + 文件夹 B 的撕裂状态
      const current = useProjectStore.getState()
      const activeProject = current.projects.find((p) => p.id === current.currentProjectId)
      if (activeProject && activeProject.path !== cwd) {
        useWorkspaceStore.getState().setCwd(activeProject.path)
      }
    })()
  }, [loadProjects])

  // 启动时应用已保存的主题
  useEffect(() => {
    const { style, mode } = useThemeStore.getState()
    applyTheme(style, mode)
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <TitleBar />
      {projectSyncWarnings.length > 0 && dismissedWarnSig !== warnSig && (
        <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-300">
          <span className="shrink-0 font-medium">项目归属同步</span>
          <span className="min-w-0 flex-1 break-all">{projectSyncWarnings.join(';')}</span>
          <button
            onClick={() => setDismissedWarnSig(warnSig)}
            className="shrink-0 rounded px-1.5 py-0.5 hover:bg-amber-500/20"
            title="关闭"
          >
            关闭
          </button>
        </div>
      )}
      <main className="flex flex-1 overflow-hidden">
        <Sidebar />
        <section className="flex flex-1 flex-col overflow-hidden">
          {currentView === 'codex' && <ChatPanel />}
          {currentView === 'projects' && <ProjectsPanel />}
          {currentView === 'terminal' && <TerminalPanel />}
          {currentView === 'git' && <GitPanel />}
          {currentView === 'files' && <FilesView />}
          {currentView === 'settings' && <SettingsPanel />}
        </section>
      </main>

      {/* Ctrl+R 对话全文搜索(对齐 Claude Code) */}
      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(hit, query) => {
          // 1) 立即关掉搜索弹窗 2) 切到 codex 视图
          setSearchOpen(false)
          setCurrentView('codex')
          // 3) 打开命中的会话并定位到具体那一条(codex 的搜索是会话粒度,
          //    精确位置由 revealSearchHit 内部的 searchOccurrences 拿)
          void revealSearchHit(hit.threadId, query)
        }}
      />
    </div>
  )
}

export default App
