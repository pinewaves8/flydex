import { Play, Trash2, Terminal, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useCodex } from '@/hooks/useCodex'
import type { CodexStatus } from '@/types/codex'

const STATUS_CONFIG: Record<CodexStatus, { label: string; icon: React.ReactNode; color: string }> =
  {
    idle: {
      label: 'Ready',
      icon: <Terminal className="h-3.5 w-3.5" />,
      color: 'text-muted-foreground',
    },
    running: {
      label: 'Running…',
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      color: 'text-blue-400',
    },
    done: {
      label: 'Completed',
      icon: <CheckCircle className="h-3.5 w-3.5" />,
      color: 'text-green-400',
    },
    error: { label: 'Error', icon: <AlertCircle className="h-3.5 w-3.5" />, color: 'text-red-400' },
  }

export function CodexPanel() {
  const { status, output, exitCode, run, clear } = useCodex()
  const [command, setCommand] = useState('')
  const [workdir, setWorkdir] = useState('')
  const outputRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  const handleRun = () => {
    if (!command.trim() || status === 'running') return
    run(command.trim(), workdir.trim() || undefined)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleRun()
    }
  }

  const statusCfg = STATUS_CONFIG[status]

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Codex Exec Tester</span>
          <span className={`flex items-center gap-1 text-xs ${statusCfg.color}`}>
            {statusCfg.icon}
            {statusCfg.label}
            {exitCode !== null && <span className="ml-1">(exit {exitCode})</span>}
          </span>
        </div>
        <button
          onClick={clear}
          disabled={status === 'running'}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      </div>

      {/* 输出区域 */}
      <div ref={outputRef} className="flex-1 overflow-y-auto bg-black/40 p-4 font-mono text-xs">
        {output.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Terminal className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p>Enter a command below to test codex exec</p>
              <p className="mt-1 text-xs opacity-70">Try: "say hello" or "what is 2+2?"</p>
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            {output.map((line) => (
              <div
                key={line.id}
                className={line.kind === 'stderr' ? 'text-red-400' : 'text-green-300'}
              >
                {line.text || '\u00A0'}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div className="border-t border-border p-3">
        <div className="mb-2 flex gap-2">
          <input
            type="text"
            value={workdir}
            onChange={(e) => setWorkdir(e.target.value)}
            placeholder="Working directory (optional, e.g. C:\\myproject)"
            className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex gap-2">
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter codex command... (Enter to run, Shift+Enter for newline)"
            disabled={status === 'running'}
            rows={2}
            className="flex-1 resize-none rounded border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
          <button
            onClick={handleRun}
            disabled={status === 'running' || !command.trim()}
            className="flex items-center gap-1.5 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Run
          </button>
        </div>
      </div>
    </div>
  )
}
