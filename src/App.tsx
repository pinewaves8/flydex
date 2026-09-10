import { useEffect } from 'react'

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
import { useCodexStore } from '@/stores/useCodexStore'
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
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const setCurrentView = useUIStore((s) => s.setCurrentView)
  const setCurrentSession = useProjectStore((s) => s.setCurrentSession)

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
        projectId={currentProjectId}
        onSelect={(hit) => {
          // 1) 立即关掉搜索弹窗
          setSearchOpen(false)
          // 2) 切到 codex 视图
          setCurrentView('codex')
          // 3) 切到目标会话(setCurrentSession 内部会清空 messages 然后异步加载)
          void setCurrentSession(hit.session_id)
          // 4) 标记待滚动的目标消息 ID(由 ChatPanel 监听处理)
          useCodexStore.getState().setPendingScrollToMessageId(hit.message_id)
        }}
      />
    </div>
  )
}

export default App
