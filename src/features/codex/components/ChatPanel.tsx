import {
  Play,
  Trash2,
  Terminal,
  AlertCircle,
  CheckCircle,
  Loader2,
  Plus,
  Wrench,
  ChevronDown,
  ChevronRight,
  Clock,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useCodexSession } from '../hooks/useCodexSession'

import { Markdown } from '@/components/ui/Markdown'
import { sessionService } from '@/services/sessionService'
import { useCodexStore } from '@/stores/useCodexStore'
import { useProjectStore } from '@/stores/useProjectStore'
import type { CodexStatus } from '@/types/codex'
import type { CodexMessage } from '@/types/codexJson'

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

function MessageCard({ message }: { message: CodexMessage }) {
  const [expanded, setExpanded] = useState(true)

  const kindStyles: Record<string, string> = {
    agent: 'border-l-2 border-green-500 bg-green-500/5 pl-3',
    tool: 'border-l-2 border-blue-500 bg-blue-500/5 pl-3',
    error: 'border-l-2 border-red-500 bg-red-500/5 pl-3',
    system: 'text-muted-foreground text-xs italic',
    usage: 'text-muted-foreground text-xs',
  }

  const kindIcons: Record<string, React.ReactNode> = {
    agent: <span className="text-green-400">●</span>,
    tool: <Wrench className="h-3 w-3 text-blue-400" />,
    error: <AlertCircle className="h-3 w-3 text-red-400" />,
    system: null,
    usage: null,
  }

  const timeStr = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  if (message.kind === 'system' || message.kind === 'usage') {
    return (
      <div className={`${kindStyles[message.kind]} flex items-center gap-1 py-0.5`}>
        <span>{message.content}</span>
        <span className="ml-auto flex items-center gap-0.5 text-[10px] opacity-50">
          <Clock className="h-2.5 w-2.5" />
          {timeStr}
        </span>
      </div>
    )
  }

  // 工具调用卡片：支持展开/收起
  if (message.kind === 'tool') {
    return (
      <div className={`rounded py-2 ${kindStyles.tool}`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="mb-1 flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {kindIcons.tool}
          <span className="capitalize">Tool</span>
          {message.toolName && (
            <span className="font-mono text-blue-400">· {message.toolName}</span>
          )}
          <span className="ml-auto flex items-center gap-0.5 text-[10px] opacity-50">
            <Clock className="h-2.5 w-2.5" />
            {timeStr}
          </span>
        </button>
        {expanded && (
          <div className="space-y-1">
            <div className="text-sm text-foreground">{message.content}</div>
            {message.toolArgs && (
              <pre className="overflow-x-auto rounded bg-black/30 p-2 text-xs text-muted-foreground">
                {JSON.stringify(message.toolArgs, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    )
  }

  // agent / error 消息
  return (
    <div className={`rounded py-2 ${kindStyles[message.kind] || ''}`}>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {kindIcons[message.kind]}
        <span className="capitalize">{message.kind}</span>
        <span className="ml-auto flex items-center gap-0.5 text-[10px] opacity-50">
          <Clock className="h-2.5 w-2.5" />
          {timeStr}
        </span>
      </div>
      {message.kind === 'agent' ? (
        <Markdown content={message.content} />
      ) : (
        <div className="whitespace-pre-wrap text-sm text-red-300">{message.content}</div>
      )}
    </div>
  )
}

export function ChatPanel() {
  const { status, output, messages, exitCode, threadId, usage, run, clear, newSession } =
    useCodexSession()
  const [command, setCommand] = useState('')
  const [workdir, setWorkdir] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const currentSessionId = useProjectStore((s) => s.currentSessionId)
  const createSession = useProjectStore((s) => s.createSession)
  const renameSession = useProjectStore((s) => s.renameSession)
  const sessions = useProjectStore((s) => s.sessions)
  const loadSession = useCodexStore((s) => s.loadSession)
  const setCurrentSession = useProjectStore((s) => s.setCurrentSession)

  // 当前会话标题
  const currentSessionTitle = sessions.find((s) => s.id === currentSessionId)?.title ?? ''

  // 切换会话时加载会话数据
  useEffect(() => {
    if (!currentSessionId) {
      useCodexStore.getState().reset()
      return
    }
    let cancelled = false
    ;(async () => {
      const session = await sessionService.load(currentSessionId)
      if (cancelled || !session) return
      loadSession({ messages: session.messages, threadId: session.threadId })
    })()
    return () => {
      cancelled = true
    }
  }, [currentSessionId, loadSession])

  // 消息变化时防抖保存会话
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      const state = useCodexStore.getState()
      const session = await sessionService.load(currentSessionId)
      if (session) {
        session.messages = state.messages
        session.threadId = state.threadId
        await sessionService.save(session)
        // 刷新会话列表的更新时间
        useProjectStore.getState().loadSessions()
      }
    }, 500)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [messages, currentSessionId])

  // 自动滚动到底部
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages])

  const handleRun = async () => {
    if (!command.trim() || status === 'running') return
    const cmd = command.trim()
    setCommand('')

    // 如果没有当前会话，自动创建一个
    let sessionId = currentSessionId
    if (!sessionId) {
      const title = cmd.length > 30 ? cmd.slice(0, 30) + '…' : cmd
      sessionId = await createSession(title, workdir.trim() || 'C:\\llm\\flydex')
      setCurrentSession(sessionId)
    } else if (currentSessionTitle === '未命名会话' || currentSessionTitle === '') {
      // 发送第一条消息时自动重命名
      const title = cmd.length > 30 ? cmd.slice(0, 30) + '…' : cmd
      await renameSession(sessionId, title)
    }

    run(cmd, workdir.trim() || undefined)
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
          <span className="text-sm font-medium">Codex Chat</span>
          <span className={`flex items-center gap-1 text-xs ${statusCfg.color}`}>
            {statusCfg.icon}
            {statusCfg.label}
            {exitCode !== null && <span className="ml-1">(exit {exitCode})</span>}
          </span>
          {threadId && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {threadId.slice(0, 8)}…
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={newSession}
            disabled={status === 'running'}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            title="New session"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
          <button
            onClick={clear}
            disabled={status === 'running'}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        </div>
      </div>

      {/* 消息区域 */}
      <div ref={messagesRef} className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && output.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Terminal className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p>Enter a message below to start a Codex session</p>
              <p className="mt-1 text-xs opacity-70">
                Multi-turn conversation is supported automatically
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* 系统/原始输出 */}
            {output.length > 0 && (
              <div className="space-y-0.5 border-l-2 border-muted pl-3">
                {output.map((line) => (
                  <div
                    key={line.id}
                    className={`text-xs ${
                      line.kind === 'stderr'
                        ? 'text-red-400'
                        : line.kind === 'system'
                          ? 'text-muted-foreground italic'
                          : 'text-green-400/70'
                    }`}
                  >
                    {line.text || '\u00A0'}
                  </div>
                ))}
              </div>
            )}
            {/* 结构化消息 */}
            {messages.map((msg) => (
              <MessageCard key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>

      {/* 状态栏 */}
      {usage && (
        <div className="border-t border-border bg-muted/30 px-4 py-1 text-[10px] text-muted-foreground">
          Input: {usage.input_tokens ?? 0} tokens · Output: {usage.output_tokens ?? 0} tokens ·
          Reasoning: {usage.reasoning_output_tokens ?? 0}
        </div>
      )}

      {/* 输入区域 */}
      <div className="border-t border-border p-3">
        <div className="mb-2 flex gap-2">
          <input
            type="text"
            value={workdir}
            onChange={(e) => setWorkdir(e.target.value)}
            placeholder="Working directory (optional)"
            className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex gap-2">
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              threadId
                ? 'Continue conversation... (Enter to send, Shift+Enter for newline)'
                : 'Enter your message... (Enter to send, Shift+Enter for newline)'
            }
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
            {threadId ? 'Send' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  )
}
