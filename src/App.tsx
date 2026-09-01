import { useEffect } from 'react'

import { Sidebar } from '@/components/layout/Sidebar'
import { TitleBar } from '@/components/layout/TitleBar'
import { ChatPanel } from '@/features/codex'
import { GitPanel } from '@/features/git'
import { ProjectsPanel } from '@/features/project'
import { SettingsPanel } from '@/features/security/SettingsPanel'
import { TerminalPanel } from '@/features/terminal'
import { useProjectStore } from '@/stores/useProjectStore'
import { applyTheme, useThemeStore } from '@/stores/useThemeStore'
import { useUIStore } from '@/stores/useUIStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'

function App() {
  const { currentView } = useUIStore()
  const loadProjects = useProjectStore((s) => s.loadProjects)

  // 应用启动时加载项目和会话列表
  useEffect(() => {
    ;(async () => {
      await loadProjects()
      // 首次启动（未手动设置过工作目录）时，跟随第一个项目作为全局工作目录
      const hasSaved = localStorage.getItem('flydex.workspace.cwd')
      if (!hasSaved) {
        const first = useProjectStore.getState().projects[0]
        if (first) useWorkspaceStore.getState().setCwd(first.path)
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
          {currentView === 'settings' && <SettingsPanel />}
        </section>
      </main>
    </div>
  )
}

export default App
