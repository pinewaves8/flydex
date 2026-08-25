import { FolderOpen, Settings, Sparkles } from 'lucide-react'

import { CodexPanel } from '@/components/CodexPanel'

function App() {
  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      {/* Title Bar */}
      <header className="flex h-10 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Flydex</span>
          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            PoC · Codex Integration
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>v0.1.0</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-56 flex-col border-r border-border bg-muted/30">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Projects</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <div className="rounded-md px-2 py-1.5 text-sm text-muted-foreground">
              No projects yet
            </div>
          </div>
          <div className="border-t border-border p-2">
            <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground">
              <Settings className="h-4 w-4" />
              Settings
            </button>
          </div>
        </aside>

        {/* Content Area - Codex Exec Tester */}
        <section className="flex flex-1 flex-col overflow-hidden">
          <CodexPanel />
        </section>
      </main>
    </div>
  )
}

export default App
