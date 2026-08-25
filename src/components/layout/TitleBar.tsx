import { Sparkles } from 'lucide-react'

export function TitleBar() {
  return (
    <header className="flex h-10 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Flydex</span>
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          v0.1.0
        </span>
      </div>
    </header>
  )
}
