import { Settings } from 'lucide-react'
import type { Terminal as TerminalIcon } from 'lucide-react'
import { useEffect } from 'react'

import { Sidebar } from '@/components/layout/Sidebar'
import { TitleBar } from '@/components/layout/TitleBar'
import { ChatPanel } from '@/features/codex'
import { GitPanel } from '@/features/git'
import { ProjectsPanel } from '@/features/project'
import { TerminalPanel } from '@/features/terminal'
import { useProjectStore } from '@/stores/useProjectStore'
import { useUIStore } from '@/stores/useUIStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'

function PlaceholderView({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof TerminalIcon
  title: string
  description: string
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <Icon className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
        <h2 className="mb-1 text-lg font-medium text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

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
          {currentView === 'settings' && (
            <PlaceholderView
              icon={Settings}
              title="Settings"
              description="Application settings coming soon"
            />
          )}
        </section>
      </main>
    </div>
  )
}

export default App
