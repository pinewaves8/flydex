import { FolderOpen, Settings, Terminal } from 'lucide-react'
import { useEffect } from 'react'

import { Sidebar } from '@/components/layout/Sidebar'
import { TitleBar } from '@/components/layout/TitleBar'
import { ChatPanel } from '@/features/codex'
import { useProjectStore } from '@/stores/useProjectStore'
import { useUIStore } from '@/stores/useUIStore'

function PlaceholderView({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Terminal
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
    loadProjects()
  }, [loadProjects])

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <TitleBar />
      <main className="flex flex-1 overflow-hidden">
        <Sidebar />
        <section className="flex flex-1 flex-col overflow-hidden">
          {currentView === 'codex' && <ChatPanel />}
          {currentView === 'projects' && (
            <PlaceholderView
              icon={FolderOpen}
              title="Projects"
              description="Project management coming soon"
            />
          )}
          {currentView === 'terminal' && (
            <PlaceholderView
              icon={Terminal}
              title="Terminal"
              description="Integrated terminal coming soon"
            />
          )}
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
