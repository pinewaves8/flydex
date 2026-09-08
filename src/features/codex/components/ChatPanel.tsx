import { invoke } from '@tauri-apps/api/core'
import {
  Trash2,
  Terminal,
  AlertCircle,
  BookOpen,
  CheckCircle,
  Loader2,
  Plus,
  Wrench,
  ChevronDown,
  ChevronRight,
  Clock,
  Square,
  ShieldAlert,
  Sparkles,
  Users,
  GitFork,
  ListChecks,
} from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'

import { useCodexSession } from '../hooks/useCodexSession'

import { FileChangeCard } from './FileChangeCard'
import { InputBox, type Attachment } from './InputBox'
import { MemoryIndicator } from './MemoryIndicator'
import { MemoryPanel } from './MemoryPanel'
import { PlanCard } from './PlanCard'
import { ReflectionCard } from './ReflectionCard'
import { ReviewCard } from './ReviewCard'
import { SuggestionChips, type SuggestionAction } from './SuggestionChips'
import { TurnSummaryCard } from './TurnSummaryCard'

import { Markdown } from '@/components/ui/Markdown'
import { SkillPalette } from '@/features/skills/SkillPalette'
import { SubagentPanel } from '@/features/subagent/SubagentPanel'
import { TaskPanel } from '@/features/tasks/TaskPanel'
import { memoryService } from '@/services/memoryService'
import { useCodexStore } from '@/stores/useCodexStore'
import { useModelStore } from '@/stores/useModelStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSkillsStore } from '@/stores/useSkillsStore'
import { useSubagentStore } from '@/stores/useSubagentStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'
import type { CodexStatus } from '@/types/codex'
import type { CodexMessage } from '@/types/codexJson'

/** 审查意图解析：/review、/rv、/cr 前缀或"审查"开头，可选模式参数
 * 支持：/review、/review uncommitted、/review commit <hash>、/review base <branch>，
 * 以及中文"审查未提交的改动"等自然语言触发。
 */
interface ReviewIntent {
  mode: 'uncommitted' | 'commit' | 'base'
  ref?: string
}
function parseReviewCommand(cmd: string): ReviewIntent | null {
  const c = cmd.trim()
  const m = c.match(/^\/(?:review|rv|cr)\b\s*(.*)$/i) || c.match(/^审查\s*(.*)$/)
  if (!m) return null
  const rest = m[1].trim()
  if (!rest || /^(未提交|当前|改动|代码)$/.test(rest)) return { mode: 'uncommitted' }
  const parts = rest.split(/\s+/)
  const head = parts[0].toLowerCase()
  if (head === 'uncommitted' || head === '当前' || head === '未提交') return { mode: 'uncommitted' }
  if (head === 'commit' || head === '提交') return { mode: 'commit', ref: parts[1] }
  if (head === 'base' || head === '对比' || head === '基线') return { mode: 'base', ref: parts[1] }
  // 其余情况把第一个词当作 commit ref（如 /review abc123 / 审查 abc123）
  return { mode: 'commit', ref: parts[0] }
}

const STATUS_CONFIG: Record<CodexStatus, { label: string; icon: React.ReactNode; color: string }> =
  {
    idle: {
      label: 'Ready',
      icon: <Terminal className="h-3.5 w-3.5" />,
      color: 'text-muted-foreground',
    },
    running: {
      label: 'Running',
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

/** 7.4.3 消息级分叉容器：hover 显示「在此分叉」按钮（并行时间线） */
function MessageForkWrapper({
  index,
  onFork,
  children,
}: {
  index: number
  onFork: (index: number) => void
  children: React.ReactNode
}) {
  return (
    <div className="group relative">
      {children}
      <button
        onClick={() => onFork(index)}
        className="absolute right-2 top-1.5 z-10 flex items-center gap-1 rounded border border-border bg-background/90 px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        title="在此消息后分叉创建新会话（并行时间线）"
      >
        <GitFork className="h-3 w-3" />
        分叉
      </button>
    </div>
  )
}

const MessageCard = memo(function MessageCard({
  message,
  repo,
  onApprovePlan,
  onCancelPlan,
  planDisabled,
  onSuggestion,
}: {
  message: CodexMessage
  repo?: string
  onApprovePlan?: (steps: string[]) => void
  onCancelPlan?: () => void
  planDisabled?: boolean
  onSuggestion?: (action: SuggestionAction) => void
}) {
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
    agent: (
      <span className="text-green-400">
        <Sparkles className="h-3 w-3" />
      </span>
    ),
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

  // 文件变更卡片：内联展示 Agent 的修改 + 接受/拒绝回调
  if (message.kind === 'file_change') {
    return <FileChangeCard message={message} repo={repo} />
  }

  // 计划卡片：展示分步计划，可编辑步骤，批准后执行
  if (message.kind === 'plan') {
    return (
      <PlanCard
        message={message}
        onApprove={onApprovePlan ?? (() => {})}
        onCancel={onCancelPlan ?? (() => {})}
        disabled={planDisabled}
      />
    )
  }

  // 审查报告卡片：分级问题清单 + 文件:行号 + 导出 Markdown
  if (message.kind === 'review') {
    return <ReviewCard message={message} />
  }

  // 权限拒绝卡片：规则引用、deny 命中（命令 + 命中原因）
  if (message.kind === 'deny') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-red-500">
            已自动拒绝
            <span className="ml-auto flex items-center gap-0.5 text-[10px] opacity-60">
              <Clock className="h-2.5 w-2.5" />
              {timeStr}
            </span>
          </div>
          <div className="mt-1 break-all font-mono text-xs text-foreground">{message.content}</div>
          {message.reason && (
            <div className="mt-1 text-xs text-muted-foreground">原因：{message.reason}</div>
          )}
        </div>
      </div>
    )
  }

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
          {/* 耗时徽章 */}
          {message.durationMs != null && (
            <span className="rounded bg-muted/50 px-1 py-px font-mono text-[10px] text-muted-foreground">
              {(message.durationMs / 1000).toFixed(2)}s
            </span>
          )}
          <span className="ml-auto flex items-center gap-0.5 text-[10px] opacity-50">
            <Clock className="h-2.5 w-2.5" />
            {timeStr}
          </span>
        </button>
        {expanded && (
          <div className="space-y-1">
            <div className="text-sm text-foreground">{message.content}</div>
            {/* 结果摘要（Claude Code 风格 —— 让用户看到工具做了什么） */}
            {message.toolResult && (
              <div className="rounded border border-sky-500/20 bg-sky-500/5 p-2 text-xs">
                <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-wide text-sky-400">
                  结果摘要
                </span>
                <span className="break-all text-foreground/90">{message.toolResult}</span>
              </div>
            )}
            {message.toolArgs != null && (
              <details className="group mt-1">
                <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-blue-400">
                  查看参数
                </summary>
                <pre className="mt-1 overflow-x-auto rounded bg-black/30 p-2 text-xs text-muted-foreground">
                  {JSON.stringify(message.toolArgs, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    )
  }

  // 本轮工作总结（仿 Claude Code 风格）
  if (message.kind === 'turn_summary' && message.turnStats) {
    return (
      <div>
        <TurnSummaryCard stats={message.turnStats} timestamp={message.timestamp} />
        <SuggestionChips stats={message.turnStats} onAction={(action) => onSuggestion?.(action)} />
      </div>
    )
  }

  // 本轮自我反思（Phase 1: Self-Reflection）
  if (message.kind === 'reflection') {
    return <ReflectionCard content={message.content} timestamp={message.timestamp} />
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
})

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
    approvePlan,
    cancelPlan,
    clear,
    newSession,
  } = useCodexSession()
  const planMode = useCodexStore((s) => s.planMode)
  const [showSkillPalette, setShowSkillPalette] = useState(false)
  const [showMemoryPanel, setShowMemoryPanel] = useState(false)
  const [showSubagent, setShowSubagent] = useState(false)
  const [showTaskPanel, setShowTaskPanel] = useState(false)
  // 注:输入相关本地 state(command / attachments / dragOver 等)已下放到 InputBox 子组件,
  // 这样 keystroke 不会触发整个消息列表 re-render(性能优化)
  const messagesRef = useRef<HTMLDivElement>(null)

  const currentSessionId = useProjectStore((s) => s.currentSessionId)
  const createSession = useProjectStore((s) => s.createSession)
  const renameSession = useProjectStore((s) => s.renameSession)
  const sessions = useProjectStore((s) => s.sessions)
  const setSessionModel = useProjectStore((s) => s.setSessionModel)
  const setCurrentSession = useProjectStore((s) => s.setCurrentSession)
  const workspaceCwd = useWorkspaceStore((s) => s.cwd)
  const streaming = useCodexStore((s) => s.streaming)
  const modelConfig = useModelStore((s) => s.config)
  const loadModels = useModelStore((s) => s.load)
  // 7.2.3 后台子代理运行数徽章
  const subagentRunning = useSubagentStore((s) => s.backgroundRunning)

  // 打字机推进：逐字追加显示（6ms/次，每次 3 字符）
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
  const currentSessionWorkdir = sessions.find((s) => s.id === currentSessionId)?.workdir
  // 会话级模型覆盖（null 表示用全局默认）
  const currentSessionModel = sessions.find((s) => s.id === currentSessionId)?.model ?? null
  const forkSession = useProjectStore((s) => s.forkSession)
  const exportSession = useProjectStore((s) => s.exportSession)
  const lastUserInput = useRef<string>('')

  /** 7.4.3 消息级分叉：在指定消息后 fork 新会话（并行时间线入口） */
  const handleForkAt = async (index: number) => {
    if (!currentSessionId) return
    const ok = window.confirm(`在此消息（第 ${index + 1} 条）后分叉创建新会话？`)
    if (!ok) return
    await forkSession(currentSessionId, index)
  }

  // 挂载时加载模型配置（全局默认模型）
  useEffect(() => {
    void loadModels()
  }, [loadModels])

  // 加载技能（工作目录变化时重新加载项目技能）
  const loadSkills = useSkillsStore((s) => s.load)
  useEffect(() => {
    if (workspaceCwd) {
      void loadSkills(workspaceCwd)
    }
  }, [workspaceCwd, loadSkills])

  // 切换会话时加载会话数据（已迁移到 useProjectStore.setCurrentSession，这里保留兼容性）
  // 注意:输入相关本地状态(command/attachments)已下放到 InputBox 子组件,
  // InputBox 自身监听 currentSessionId 变化时清空,无需在此清理
  useEffect(() => {
    if (!currentSessionId) {
      useCodexStore.getState().reset()
    }
  }, [currentSessionId])

  // 自动滚动到底部（消息变化或打字机推进时）
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages, streaming?.shown])

  /** 压缩上下文（6.1 P2）：长会话时把模型摘要为上下文快照 —— 重置为新会话
   *
   * 通过 loadSession 替换 messages 为快照 + threadId 置空，下次 run/exec 开启新 thread；
   * 从快照 + 记忆注入继续工作。
   */
  const handleCompact = async () => {
    if (status === 'running') return
    const msgs = useCodexStore.getState().messages
    if (msgs.length === 0) return
    const text = msgs
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n')
    try {
      const summary = await memoryService.compactSummary(text.slice(0, 30000))
      const snapshot = `[上下文快照]\n${summary}\n\n（原会话已压缩为快照，可在此上下文基础上继续工作）`
      useCodexStore.getState().loadSession({
        messages: [
          {
            id: `msg_compact_${Date.now()}`,
            kind: 'system',
            content: snapshot,
            timestamp: Date.now(),
          },
        ],
        threadId: null,
      })
    } catch (e) {
      console.error('[compact]', e)
    }
  }

  const handleSuggestionAction = async (action: SuggestionAction) => {
    switch (action.type) {
      case 'review':
        // 用当前 workdir 触发 review（复用现有 /review 流程）
        if (currentSessionWorkdir || workspaceCwd) {
          const workdir = currentSessionWorkdir || workspaceCwd
          try {
            const diff = (await invoke('git_review_diff', {
              repo: workdir,
              mode: 'uncommitted',
              ref_: null,
            })) as string
            await invoke('write_review_diff', { repo: workdir, content: diff })
            useCodexStore.getState().setReviewMode(true)
            const hasDiff = diff.trim().length > 0
            await run(
              hasDiff
                ? '请审查代码变更。diff 内容已写入工作目录下 .flydex-review.diff 文件中，请读取后输出结构化审查报告。'
                : '当前没有检测到代码变更，请说明这一点。',
              workdir,
              currentSessionModel,
              'review',
            )
            await invoke('remove_review_diff', { repo: workdir }).catch(() => {})
          } catch (e) {
            useCodexStore.getState().appendOutput({
              text: `审查失败: ${String(e)}`,
              kind: 'stderr',
            })
          }
        }
        break
      case 'rerun':
        // 复用本轮最后一次用户输入（取最近 user/agent 对）
        if (lastUserInput.current) {
          await run(
            lastUserInput.current,
            currentSessionWorkdir || workspaceCwd,
            currentSessionModel,
          )
        } else {
          useCodexStore.getState().appendOutput({ text: '没有可重跑的上一次输入', kind: 'system' })
        }
        break
      case 'export':
        // 导出会话为 Markdown 并下载
        try {
          const sid = useProjectStore.getState().currentSessionId
          if (!sid) break
          const content = await exportSession(sid, 'markdown')
          const blob = new Blob([content], { type: 'text/markdown' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `session-${sid}.md`
          a.click()
          URL.revokeObjectURL(url)
          useCodexStore.getState().appendOutput({ text: '已导出 Markdown', kind: 'system' })
        } catch (e) {
          useCodexStore.getState().appendOutput({ text: `导出失败: ${String(e)}`, kind: 'stderr' })
        }
        break
      case 'shell':
        // 内部 shell 提示（仅记录到 output）
        useCodexStore.getState().appendOutput({
          text: `[shell 提示] ${action.command}`,
          kind: 'system',
        })
        break
      case 'clear':
        clear()
        break
      case 'dismiss':
      default:
        // 简易 dismiss：把摘要下方建议隐藏（再次发送消息时自动重新出现）
        break
    }
  }

  /** 发送回调（InputBox 通过 onSend 触发）—— 性能优化:用 useCallback 稳定引用,避免 InputBox 重渲染 */
  const handleSend = useCallback(
    async (cmd: string, _attachments: Attachment[]) => {
      if (!cmd.trim() || status === 'running') return
      // 记录本次用户输入（"再跑一次" 建议会用到）
      lastUserInput.current = cmd

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
      // 计划模式开启时 mode='plan'（后端强制 read-only 沙箱 + 注入计划指令）
      const planModeActive = useCodexStore.getState().planMode
      const workdir = currentSessionWorkdir || workspaceCwd

      let finalCmd = cmd
      // 技能注入：检测 /skill-name 前缀或自然语言触发词匹配
      const skillsStore = useSkillsStore.getState()
      // 检测 /skill-name 前缀
      const slashSkillMatch = cmd.match(/^\/(\S+)\s*(.*)$/)
      if (slashSkillMatch) {
        const skillName = slashSkillMatch[1].toLowerCase()
        const userInput = slashSkillMatch[2]
        const skill = skillsStore.find(skillName)
        if (skill && skill.enabled) {
          // 找到技能，注入提示词
          finalCmd = skillsStore.execute(skillName, userInput || cmd)
        }
        // 如果没找到匹配技能，原样发送（不拦截）
      } else {
        // 自然语言触发词匹配
        const matched = skillsStore.matchTriggers(cmd)
        if (matched.length > 0) {
          finalCmd = skillsStore.execute(matched[0].name, cmd)
        }
      }

      // 审查模式：/review 前缀或"审查"开头 —— 生成 diff 写入临时文件，read-only 审查
      const reviewIntent = parseReviewCommand(finalCmd)
      if (reviewIntent && workdir) {
        try {
          const diff = (await invoke('git_review_diff', {
            repo: workdir,
            mode: reviewIntent.mode,
            ref_: reviewIntent.ref ?? null,
          })) as string
          await invoke('write_review_diff', { repo: workdir, content: diff })
          useCodexStore.getState().setReviewMode(true)
          const hasDiff = diff.trim().length > 0
          const prompt = `请审查代码变更。diff 内容已写入工作目录下 .flydex-review.diff 文件${
            hasDiff
              ? '，请读取后按要求输出结构化审查报告。'
              : '，但当前没有检测到任何代码变更，请直接说明这一点。'
          }。`
          await run(prompt, workdir, currentSessionModel, 'review')
          await invoke('remove_review_diff', { repo: workdir }).catch(() => {})
          return
        } catch (e) {
          useCodexStore.getState().appendOutput({ text: `审查失败: ${String(e)}`, kind: 'stderr' })
          return
        }
      }

      // 收集已落盘的图片附件路径(从当前 InputBox 内部状态不可见,但 attachments 中已有 path)
      const imagePaths = _attachments.map((a) => a.path).filter(Boolean)
      run(finalCmd, workdir, currentSessionModel, planModeActive ? 'plan' : undefined, imagePaths)
    },
    [
      status,
      currentSessionId,
      currentSessionTitle,
      currentSessionWorkdir,
      workspaceCwd,
      createSession,
      renameSession,
      setCurrentSession,
      run,
      currentSessionModel,
    ],
  )

  // 切换会话模型覆盖。模型与会话 thread 绑定：若会话已有历史 thread，自动新建（新 threadId），
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

  const statusCfg = STATUS_CONFIG[status]

  return (
    <div className="flex h-full flex-col">
      {/* 工具 */}
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
          {/* 上下文与记忆指示器（6.1）：L1/L2 记忆用量 + 会话上下文用量 + 超限压缩 */}
          <MemoryIndicator
            workdir={currentSessionWorkdir || workspaceCwd}
            onCompact={handleCompact}
          />
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
            onClick={() => setShowSkillPalette(true)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title="Skills (Ctrl+Shift+P)"
          >
            <Sparkles className="h-3 w-3" />
            Skills
          </button>
          <button
            onClick={() => setShowTaskPanel(true)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title="任务（持久任务列表，对齐 Claude Code /tasks）"
          >
            <ListChecks className="h-3 w-3" />
            Tasks
          </button>
          <button
            onClick={() => setShowMemoryPanel(true)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title="记忆管理（查看/编辑项目记忆与用户记忆）"
          >
            <BookOpen className="h-3 w-3" />
            记忆
          </button>
          <button
            onClick={() => setShowSubagent(true)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title="子代理并行：派发多个独立 codex 子任务并行执行（角色分派 / 团队接力 / 后台常驻）"
          >
            <Users className="h-3 w-3" />
            子代理
            {subagentRunning > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                {subagentRunning}
              </span>
            )}
          </button>
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
            {/* 结构化消息（7.4.3 支持消息级分叉） */}
            {messages.map((msg, index) => (
              <MessageForkWrapper key={msg.id} index={index} onFork={handleForkAt}>
                <MessageCard
                  message={msg}
                  repo={currentSessionWorkdir || workspaceCwd}
                  onApprovePlan={approvePlan}
                  onCancelPlan={cancelPlan}
                  planDisabled={status === 'running'}
                  onSuggestion={handleSuggestionAction}
                />
              </MessageForkWrapper>
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

      {/* 技能面板 */}
      {showSkillPalette && (
        <SkillPalette
          onSelect={(name) => {
            const skill = useSkillsStore.getState().find(name)
            if (skill && skill.interface?.displayName) {
              // 通过 store bridge 通知 InputBox 更新输入前缀(避免跨组件直接引用)
              useCodexStore.getState().setPendingCommand(`/${skill.name} `)
            }
          }}
          onClose={() => setShowSkillPalette(false)}
        />
      )}

      {/* 子代理并行面板（6.3 P1） */}
      <SubagentPanel
        open={showSubagent}
        onClose={() => setShowSubagent(false)}
        defaultWorkdir={currentSessionWorkdir || workspaceCwd}
        defaultModel={currentSessionModel}
      />

      {/* 任务面板（v4.2） */}
      <TaskPanel
        open={showTaskPanel}
        onClose={() => setShowTaskPanel(false)}
        projectId={sessions.find((ss) => ss.id === currentSessionId)?.projectId ?? null}
        sessionId={currentSessionId}
      />

      {/* 记忆管理面板（v4.1） */}
      <MemoryPanel
        workdir={currentSessionWorkdir || workspaceCwd}
        open={showMemoryPanel}
        onClose={() => setShowMemoryPanel(false)}
      />

      {/* 输入区域 —— 拆为独立子组件(性能优化) */}
      <InputBox
        status={status}
        threadId={threadId}
        approval={approval}
        respondApproval={respondApproval}
        onSend={handleSend}
        currentSessionWorkdir={currentSessionWorkdir}
        workspaceCwd={workspaceCwd}
        planMode={planMode}
      />
    </div>
  )
}
