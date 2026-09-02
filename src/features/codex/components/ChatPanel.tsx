import { invoke } from '@tauri-apps/api/core'
import {
  Play,
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
  FolderOpen,
  Square,
  ShieldAlert,
  ListChecks,
  Sparkles,
  ImagePlus,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useCodexSession } from '../hooks/useCodexSession'

import { FileChangeCard } from './FileChangeCard'
import { MemoryIndicator } from './MemoryIndicator'
import { MemoryPanel } from './MemoryPanel'
import { MemorySettle } from './MemorySettle'
import { PlanCard } from './PlanCard'
import { ReviewCard } from './ReviewCard'

import { Markdown } from '@/components/ui/Markdown'
import { SkillPalette } from '@/features/skills/SkillPalette'
import { useCodexStore } from '@/stores/useCodexStore'
import { useModelStore } from '@/stores/useModelStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSecurityStore } from '@/stores/useSecurityStore'
import { useSkillsStore } from '@/stores/useSkillsStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'
import type { CodexStatus } from '@/types/codex'
import type { CodexMessage } from '@/types/codexJson'
import { approvalLabel } from '@/types/security'

/** 审查意图解析：/review、/rv、/cr 前缀或"审查"开头，可选模式参数
 *
 * 支持：/review、/review uncommitted、/review commit <hash>、/review base <branch>，
 * 以及中文"审查未提交的改动"等自然语言形式。
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

function MessageCard({
  message,
  repo,
  onApprovePlan,
  onCancelPlan,
  planDisabled,
}: {
  message: CodexMessage
  repo?: string
  onApprovePlan?: (steps: string[]) => void
  onCancelPlan?: () => void
  planDisabled?: boolean
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

  // 文件变更卡片：内联展示 Agent 的修改 + 接受/拒绝回滚
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
    approvePlan,
    cancelPlan,
    clear,
    newSession,
  } = useCodexSession()
  const planMode = useCodexStore((s) => s.planMode)
  const [command, setCommand] = useState('')
  const [showSkillPalette, setShowSkillPalette] = useState(false)
  const [showMemoryPanel, setShowMemoryPanel] = useState(false)
  // 图像附件：{ name: 原始文件名, dataUrl: 预览用 base64 data URL, path: 落盘后的相对路径, saving: 是否保存中 }
  const [attachments, setAttachments] = useState<
    { name: string; dataUrl: string; path: string; saving: boolean }[]
  >([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 落盘中的附件计数 + 已落盘路径（发送时等待 pending 归零后读取）
  const pendingSavesRef = useRef(0)
  const savedPathsRef = useRef<string[]>([])
  const messagesRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const currentSessionId = useProjectStore((s) => s.currentSessionId)
  const createSession = useProjectStore((s) => s.createSession)
  const renameSession = useProjectStore((s) => s.renameSession)
  const sessions = useProjectStore((s) => s.sessions)
  const setSessionModel = useProjectStore((s) => s.setSessionModel)
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

  // 加载技能（工作目录变化时重新加载项目技能）
  const loadSkills = useSkillsStore((s) => s.load)
  useEffect(() => {
    if (workspaceCwd) {
      void loadSkills(workspaceCwd)
    }
  }, [workspaceCwd, loadSkills])

  // 切换会话时加载会话数据（已迁移到 useProjectStore.setCurrentSession，这里保留兼容性）
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

  // 运行结束时把焦点还给输入框（便于连续对话）
  useEffect(() => {
    if (status === 'done' || status === 'error') {
      inputRef.current?.focus()
    }
  }, [status])

  const handleRun = async () => {
    if ((!command.trim() && attachments.length === 0) || status === 'running') return
    let cmd = command.trim()
    // 纯图片发送（无文字）：注入默认指令（后端也有兜底，这里前端友好提示文案）
    if (!cmd && attachments.length > 0) {
      cmd = '请描述你看到的图片内容，并结合项目上下文给出分析和建议。'
    }
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
    // 计划模式开启时传 mode='plan'（后端强制 read-only 沙箱 + 注入计划指令）
    const planModeActive = useCodexStore.getState().planMode
    const workdir = currentSessionWorkdir || workspaceCwd

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
        cmd = skillsStore.execute(skillName, userInput || cmd)
      }
      // 如果没找到匹配技能，原样发送（不拦截）
    } else {
      // 自然语言触发词匹配
      const matched = skillsStore.matchTriggers(cmd)
      if (matched.length > 0) {
        cmd = skillsStore.execute(matched[0].name, cmd)
      }
    }

    // 审查模式：/review 前缀或"审查"开头 → 取 diff 写临时文件 → read-only 审查
    const reviewIntent = parseReviewCommand(cmd)
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
        const prompt = `请审查代码变更。diff 内容已写入工作目录下的 .flydex-review.diff 文件${
          hasDiff
            ? '，请读取后按要求输出结构化审查报告'
            : '，但当前没有检测到任何代码变更，请直接说明这一点'
        }。`
        await run(prompt, workdir, currentSessionModel, 'review')
        await invoke('remove_review_diff', { repo: workdir }).catch(() => {})
        return
      } catch (e) {
        useCodexStore.getState().appendOutput({ text: `审查失败: ${String(e)}`, kind: 'stderr' })
        return
      }
    }
    // 等待图像附件全部落盘完成（pending 归零）后再发送
    if (pendingSavesRef.current > 0) {
      const deadline = Date.now() + 5000
      while (pendingSavesRef.current > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    const imagePaths = savedPathsRef.current.slice()
    run(cmd, workdir, currentSessionModel, planModeActive ? 'plan' : undefined, imagePaths)
    // 发送后清空附件
    if (imagePaths.length > 0) {
      savedPathsRef.current = []
      setAttachments([])
    }
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

  // ─── 图像附件处理 ────────────────────────────────────────────
  // 读取 File 为 base64 data URL（用于预览 + 传给后端落盘）
  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })

  // 附加一个图片文件：读 base64 → 调后端落盘 → 存入 attachments（path 为相对路径）
  const addImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return
    const workdir = currentSessionWorkdir || workspaceCwd
    if (!workdir) {
      useCodexStore.getState().appendOutput({
        text: '附加图片前请先打开/选择一个工作目录',
        kind: 'stderr',
      })
      return
    }
    const dataUrl = await fileToDataUrl(file)
    pendingSavesRef.current += 1
    setAttachments((prev) => [...prev, { name: file.name, dataUrl, path: '', saving: true }])
    try {
      const relPath = (await invoke('save_attachment_image', {
        workdir,
        fileName: file.name,
        data: dataUrl,
      })) as string
      savedPathsRef.current.push(relPath)
      setAttachments((prev) =>
        prev.map((a) => (a.dataUrl === dataUrl ? { ...a, path: relPath, saving: false } : a)),
      )
    } catch (e) {
      setAttachments((prev) => prev.filter((a) => a.dataUrl !== dataUrl))
      useCodexStore.getState().appendOutput({
        text: `保存图片失败: ${String(e)}`,
        kind: 'stderr',
      })
    } finally {
      pendingSavesRef.current -= 1
    }
  }

  const removeAttachment = (dataUrl: string) =>
    setAttachments((prev) => prev.filter((a) => a.dataUrl !== dataUrl))

  // 文件选择按钮
  const pickImages = () => fileInputRef.current?.click()

  // 粘贴截图/图片：从剪贴板拿 image 文件
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          void addImageFile(file)
        }
        return
      }
    }
  }

  // 拖拽图片到输入区
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer?.files
    if (!files) return
    for (const file of Array.from(files)) {
      void addImageFile(file)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl+Shift+P: 打开技能面板
    if (e.ctrlKey && e.shiftKey && e.key === 'P') {
      e.preventDefault()
      setShowSkillPalette(true)
      return
    }
    // Enter 发送（Shift+Enter 换行）
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
          {/* 上下文与记忆指示器（6.1）：L1/L2 记忆层 + 会话上下文用量 */}
          <MemoryIndicator workdir={currentSessionWorkdir || workspaceCwd} />
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
            onClick={() => setShowMemoryPanel(true)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title="记忆管理（查看/编辑项目记忆与用户记忆）"
          >
            <BookOpen className="h-3 w-3" />
            记忆
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
            {/* 结构化消息 */}
            {messages.map((msg) => (
              <MessageCard
                key={msg.id}
                message={msg}
                repo={currentSessionWorkdir || workspaceCwd}
                onApprovePlan={approvePlan}
                onCancelPlan={cancelPlan}
                planDisabled={status === 'running'}
              />
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
              setCommand(`/${skill.name} `)
            }
            inputRef.current?.focus()
          }}
          onClose={() => setShowSkillPalette(false)}
        />
      )}

      {/* 记忆管理面板（6.1） */}
      <MemoryPanel
        workdir={currentSessionWorkdir || workspaceCwd}
        open={showMemoryPanel}
        onClose={() => setShowMemoryPanel(false)}
      />

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
        {/* 记忆沉淀入口（6.1）：会话完成后提炼候选 → 勾选 → 写入项目记忆 */}
        <MemorySettle workdir={currentSessionWorkdir || workspaceCwd} />
        <div className="mb-2 flex items-center gap-2">
          <button
            onClick={() => useCodexStore.getState().setPlanMode(!planMode)}
            disabled={status === 'running'}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
              planMode
                ? 'bg-primary/15 text-primary ring-1 ring-primary/40'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
            title="计划模式：发送后先生成可编辑的分步计划，批准后再执行（不直接动手改文件）"
          >
            <ListChecks className="h-3 w-3" />
            Plan
          </button>
          {planMode ? (
            <span className="text-[10px] text-primary/70">
              计划模式已开启：先生成计划，批准后再执行
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/50">
              计划模式：先出方案，批准后动手
            </span>
          )}
        </div>
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
        {/* 图像附件缩略图预览 */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div
                key={a.dataUrl}
                className="relative h-16 w-16 overflow-hidden rounded border border-border"
              >
                <img
                  src={a.dataUrl}
                  alt={a.name}
                  className="h-full w-full object-cover"
                  title={a.name}
                />
                {a.saving && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(a.dataUrl)}
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                  title="移除图片"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          {/* 隐藏的文件选择 input：多选图片 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files
              if (files) {
                for (const f of Array.from(files)) void addImageFile(f)
              }
              e.target.value = ''
            }}
          />
          <button
            onClick={pickImages}
            disabled={status === 'running'}
            className="flex items-center gap-1.5 rounded border border-input bg-background px-2 py-2 text-muted-foreground hover:bg-accent disabled:opacity-50"
            title="附加图片（也可拖拽到输入框或直接粘贴截图）"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <textarea
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            placeholder={
              status === 'running'
                ? 'Waiting for response... (type your next message)'
                : threadId
                  ? 'Continue conversation... (Enter to send, Shift+Enter for newline)'
                  : 'Enter your message... (Enter to send, Shift+Enter for newline, paste/drop image)'
            }
            rows={2}
            className={`flex-1 resize-none rounded border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring ${
              dragOver ? 'border-primary ring-1 ring-primary' : 'border-input'
            }`}
          />
          <button
            onClick={handleRun}
            disabled={status === 'running' || (!command.trim() && attachments.length === 0)}
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
