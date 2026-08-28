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
  FolderOpen,
  Square,
  ShieldAlert,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useCodexSession } from '../hooks/useCodexSession'

import { Markdown } from '@/components/ui/Markdown'
import { sessionService } from '@/services/sessionService'
import { useCodexStore } from '@/stores/useCodexStore'
import { useModelStore } from '@/stores/useModelStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSecurityStore } from '@/stores/useSecurityStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'
import type { CodexStatus } from '@/types/codex'
import type { CodexMessage } from '@/types/codexJson'
import { approvalLabel } from '@/types/security'

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
  // 打字机流式状态：若该消息正在逐字显示，用已渲染文本
  const streaming = useCodexStore((s) => s.streaming)
  const isStreaming = streaming?.id === message.id

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
            {message.toolArgs != null && (
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
        <Markdown
          content={isStreaming ? streaming.full.slice(0, streaming.shown) : message.content}
        />
      ) : (
        <div className="whitespace-pre-wrap text-sm text-red-300">{message.content}</div>
      )}
    </div>
  )
}

export function ChatPanel() {
  const {
    status,
    output,
    messages,
    exitCode,
    threadId,
    usage,
    runningCommands,
    approval,
    run,
    stop,
    respondApproval,
    clear,
    newSession,
  } = useCodexSession()
  const [command, setCommand] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const currentSessionId = useProjectStore((s) => s.currentSessionId)
  const createSession = useProjectStore((s) => s.createSession)
  const renameSession = useProjectStore((s) => s.renameSession)
  const sessions = useProjectStore((s) => s.sessions)
  const setSessionModel = useProjectStore((s) => s.setSessionModel)
  const loadSession = useCodexStore((s) => s.loadSession)
  const setCurrentSession = useProjectStore((s) => s.setCurrentSession)
  const workspaceCwd = useWorkspaceStore((s) => s.cwd)
  const streaming = useCodexStore((s) => s.streaming)
  const securityConfig = useSecurityStore((s) => s.config)
  const modelConfig = useModelStore((s) => s.config)
  const loadModels = useModelStore((s) => s.load)

  // 打字机推进：逐字追加显示（16ms/次，每次 3 字符）
  useEffect(() => {
    if (!streaming) return
    if (streaming.shown >= streaming.full.length) {
      useCodexStore.getState().setStreaming(null)
      return
    }
    const timer = setTimeout(() => {
      useCodexStore.getState().advanceStream(3)
    }, 16)
    return () => clearTimeout(timer)
  }, [streaming])

  // 当前会话标题
  const currentSessionTitle = sessions.find((s) => s.id === currentSessionId)?.title ?? ''
  // 当前会话绑定的工作目录（遵循 codex：会话绑定创建时的 cwd）
  const currentSessionWorkdir = sessions.find((s) => s.id === currentSessionId)?.workdir ?? ''
  // 会话级模型覆盖（null 表示用全局默认）
  const currentSessionModel = sessions.find((s) => s.id === currentSessionId)?.model ?? null

  // 挂载时加载模型配置（全局默认模型）
  useEffect(() => {
    void loadModels()
  }, [loadModels])

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

  // 自动滚动到底部（消息变化或打字机推进时）
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages, streaming?.shown])

  // 运行结束时把焦点还给输入框（便于连续对话）
  useEffect(() => {
    if (status === 'done' || status === 'error') {
      inputRef.current?.focus()
    }
  }, [status])

  const handleRun = async () => {
    if (!command.trim() || status === 'running') return
    const cmd = command.trim()
    setCommand('')
    // 发送后保持焦点在输入框，便于继续输入下一条
    requestAnimationFrame(() => inputRef.current?.focus())

    // 如果没有当前会话，自动创建一个（绑定全局工作目录）
    let sessionId = currentSessionId
    if (!sessionId) {
      const title = cmd.length > 30 ? cmd.slice(0, 30) + '…' : cmd
      sessionId = await createSession(title, workspaceCwd)
      setCurrentSession(sessionId)
    } else if (currentSessionTitle === '未命名会话' || currentSessionTitle === '') {
      // 发送第一条消息时自动重命名
      const title = cmd.length > 30 ? cmd.slice(0, 30) + '…' : cmd
      await renameSession(sessionId, title)
    }

    // 遵循 codex：resume 会话用会话绑定的 cwd，新会话用全局 cwd；模型用会话级覆盖（无则全局默认）
    run(cmd, currentSessionWorkdir || workspaceCwd, currentSessionModel)
  }

  // 切换会话模型覆盖。模型与会话 thread 绑定：若会话已有历史 thread，自动新建（清 threadId），
  // 避免跨模型 resume 触发 codex 的模型不一致警告（也符合 codex"模型绑定会话"语义）
  const handleModelChange = async (modelId: string) => {
    if (!currentSessionId) {
      return
    }
    await setSessionModel(currentSessionId, modelId === '__global__' ? null : modelId)
    if (useCodexStore.getState().threadId) {
      useCodexStore.getState().reset()
      useCodexStore.getState().setThreadId(null)
    }
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
          {/* 会话级模型覆盖 */}
          <select
            value={currentSessionModel ?? '__global__'}
            onChange={(e) => void handleModelChange(e.target.value)}
            disabled={status === 'running'}
            title="会话模型覆盖（切换仅对当前会话生效）"
            className="max-w-[180px] truncate rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none hover:border-primary/50 disabled:opacity-50"
          >
            <option value="__global__">
              {modelConfig ? `全局：${modelConfig.current_model}` : '全局默认'}
            </option>
            {modelConfig?.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
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
          {status === 'running' && (
            <button
              onClick={stop}
              className="flex items-center gap-1 rounded bg-red-600/15 px-2 py-1 text-xs text-red-400 hover:bg-red-600/25"
              title="Stop current run"
            >
              <Square className="h-3 w-3" />
              Stop
            </button>
          )}
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

      {/* 实时命令看板 */}
      {runningCommands.length > 0 && (
        <div className="border-b border-border bg-muted/20 px-4 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Running commands
          </div>
          <div className="space-y-1">
            {runningCommands.map((c) => (
              <div key={c.id} className="flex items-center gap-2 font-mono text-xs text-blue-300">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                <span className="truncate" title={c.command}>
                  {c.command}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
        {approval && (
          <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                <ShieldAlert className="h-3.5 w-3.5" />
                需要审批
              </div>
              <span className="text-[10px] text-amber-300/60">
                策略：{approvalLabel(securityConfig?.approval_policy ?? 'on-request')}
              </span>
            </div>
            <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-xs text-amber-200">
              {approval.command || approval.description || '未知操作'}
            </pre>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => respondApproval(true)}
                className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-500"
              >
                允许
              </button>
              <button
                onClick={() => respondApproval(false)}
                className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500"
              >
                拒绝
              </button>
            </div>
          </div>
        )}
        <div className="mb-2 flex items-center gap-1.5">
          <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span
            className="truncate font-mono text-[11px] text-muted-foreground"
            title={currentSessionWorkdir || workspaceCwd}
          >
            {currentSessionWorkdir || workspaceCwd}
          </span>
          {currentSessionWorkdir && currentSessionWorkdir !== workspaceCwd && (
            <span className="shrink-0 text-[10px] text-muted-foreground/60">
              （会话目录，非当前工作目录）
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              status === 'running'
                ? 'Waiting for response... (type your next message)'
                : threadId
                  ? 'Continue conversation... (Enter to send, Shift+Enter for newline)'
                  : 'Enter your message... (Enter to send, Shift+Enter for newline)'
            }
            rows={2}
            className="flex-1 resize-none rounded border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
