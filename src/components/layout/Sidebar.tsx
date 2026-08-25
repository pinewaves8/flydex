import { FolderOpen, Settings, Terminal, MessageSquare } from 'lucide-react'

import { useUIStore, type View } from '@/stores/useUIStore'

const NAV_ITEMS: { view: View; label: string; icon: typeof MessageSquare }[] = [
  { view: 'codex', label: 'Codex', icon: MessageSquare },
  { view: 'projects', label: 'Projects', icon: FolderOpen },
  { view: 'terminal', label: 'Terminal', icon: Terminal },
]

export function Sidebar() {
  const { currentView, setCurrentView } = useUIStore()

  return (
    <aside className="flex w-56 flex-col border-r border-border bg-muted/30">
      <nav className="flex-1 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = currentView === item.view
          return (
            <button
              key={item.view}
              onClick={() => setCurrentView(item.view)}
              className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          )
        })}
      </nav>
      <div className="border-t border-border p-2">
        <button
          onClick={() => setCurrentView('settings')}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
            currentView === 'settings'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
      </div>
    </aside>
  )
}
