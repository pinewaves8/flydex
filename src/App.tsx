import { useState } from "react";
import { Terminal, FolderOpen, Settings, Sparkles } from "lucide-react";

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      {/* Title Bar */}
      <header className="flex h-10 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Flydex</span>
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
            <span className="text-xs font-medium text-muted-foreground">
              Projects
            </span>
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

        {/* Content Area */}
        <section className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Terminal className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Welcome to Flydex</h1>
            <p className="max-w-md text-sm text-muted-foreground">
              A cross-platform desktop AI coding agent. Open a project to get
              started.
            </p>
          </div>

          <button
            onClick={() => setCount((c) => c + 1)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Test button (clicked {count} times)
          </button>
        </section>
      </main>
    </div>
  );
}

export default App;
