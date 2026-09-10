import { invoke } from '@tauri-apps/api/core'
import {
  Brain,
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
  User,
  GitFork,
  ListChecks,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useCodexSession } from '../hooks/useCodexSession'

import { FileChangeCard } from './FileChangeCard'
import { InputBox, type Attachment } from './InputBox'
import { MemoryIndicator } from './MemoryIndicator'
import { MemoryPanel } from './MemoryPanel'
import { PlanCard } from './PlanCard'
import { ReflectionCard } from './ReflectionCard'
import { ReviewCard } from './ReviewCard'
import { SuggestionChips, type SuggestionAction } from './SuggestionChips'
import { TurnPlanPanel } from './TurnPlanPanel'
import { TurnSummaryCard } from './TurnSummaryCard'

import { Markdown } from '@/components/ui/Markdown'
import { hasInjectedContext } from '@/features/codex/threadItems'
import { SkillPalette } from '@/features/skills/SkillPalette'
import { SubagentPanel } from '@/features/subagent/SubagentPanel'
import { TaskPanel } from '@/features/tasks/TaskPanel'
import {
  initService,
  initStateService,
  type InitStateData,
  getInitStepLabel,
} from '@/services/initService'
import { memoryService } from '@/services/memoryService'
import { useCodexStore, type ThreadTurnMeta } from '@/stores/useCodexStore'
import { useModelStore } from '@/stores/useModelStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSkillsStore } from '@/stores/useSkillsStore'
import { useSubagentStore } from '@/stores/useSubagentStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'
import type { CodexStatus } from '@/types/codex'
import type { CodexMessage } from '@/types/codexJson'

/** 流式思考预览最多显示尾部这么多字符(完整内容在完成后的可展开卡片里) */
const THINKING_TAIL_CHARS = 400

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

/** 消息流的渲染分组:连续的工具消息合成一「工具段」 */
type RenderBlock = { kind: 'single'; msg: CodexMessage } | { kind: 'tools'; items: CodexMessage[] }

/**
 * 把连续的工具消息归为一段。
 *
 * codex 的 item 事件是扁平的(没有 turn 级分组),而 Claude Code 会把一串工具调用
 * 收成一行汇总。这里按「相邻同类」聚合即可覆盖实际形态:agent/system 等消息天然
 * 打断工具段,所以一段就对应「一轮里连着跑的几次工具调用」。
 */
function buildRenderBlocks(messages: CodexMessage[]): RenderBlock[] {
  const blocks: RenderBlock[] = []
  let run: CodexMessage[] = []
  const flush = () => {
    if (run.length === 1) blocks.push({ kind: 'single', msg: run[0] })
    else if (run.length > 1) blocks.push({ kind: 'tools', items: run })
    run = []
  }
  for (const msg of messages) {
    if (msg.kind === 'tool') run.push(msg)
    else {
      flush()
      blocks.push({ kind: 'single', msg })
    }
  }
  flush()
  return blocks
}

/** 一轮对话的渲染单元 */
interface TurnGroup {
  key: string
  /** codex 的 turnId;前端合成的卡片不属于任何轮,故可缺省 */
  turnId?: string
  blocks: RenderBlock[]
}

/**
 * 先按 turn 分组,组内再做「相邻工具归并」
 *
 * 为什么要先分组:分支(P6)以轮为单位,「这一轮做了什么」也是用户读对话的自然单位。
 * 前端合成的卡片(turn_summary / reflection 等)没有 turnId,跟随前一条消息所属的轮,
 * 否则每张本地卡都会另起一段。
 */
function buildTurnGroups(messages: CodexMessage[]): TurnGroup[] {
  const order: string[] = []
  const byKey = new Map<string, CodexMessage[]>()
  let lastKey: string | null = null
  for (const m of messages) {
    const key = m.turnId ?? lastKey ?? 'local'
    if (m.turnId) lastKey = m.turnId
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = []
      byKey.set(key, bucket)
      order.push(key)
    }
    bucket.push(m)
  }
  return order.map((key) => ({
    key,
    turnId: key === 'local' ? undefined : key,
    blocks: buildRenderBlocks(byKey.get(key)!),
  }))
}

/** 一段连续工具调用的汇总卡(折叠时只占一行) */
function ToolRunCard({ items, repo }: { items: CodexMessage[]; repo?: string }) {
  const [open, setOpen] = useState(false)
  const totalMs = items.reduce((n, m) => n + (m.durationMs ?? 0), 0)
  // 按工具名归类,给出 "Read ×3 · Grep ×1" 这样的概览
  const byName = new Map<string, number>()
  for (const msg of items) {
    const name = msg.toolName ?? 'tool'
    byName.set(name, (byName.get(name) ?? 0) + 1)
  }
  const summary = [...byName.entries()]
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(' · ')

  return (
    <div className="rounded border border-border/50 bg-muted/10">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <Wrench className="h-3 w-3 shrink-0 text-blue-400" />
        <span className="shrink-0 font-medium">{items.length} 次工具调用</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
          {summary}
        </span>
        {totalMs > 0 && (
          <span className="shrink-0 rounded bg-muted/50 px-1 py-px font-mono text-[10px]">
            {(totalMs / 1000).toFixed(1)}s
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-0.5 border-t border-border/40 px-2 py-1">
          {items.map((msg) => (
            <MessageCard key={msg.id} message={msg} repo={repo} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 一轮对话的容器:轮内消息 + 轮边界 */
function TurnBlockView({
  group,
  turnMeta,
  repo,
  ordinal,
  running,
  onFork,
  onApprovePlan,
  onCancelPlan,
  planDisabled,
  onSuggestion,
  registerRef,
}: {
  group: TurnGroup
  turnMeta?: ThreadTurnMeta
  repo?: string
  /** 该轮在本次已加载列表里的序号(从 1 开始),用于分叉文案 */
  ordinal: number
  /** 该轮是否还在进行中 —— 进行中的轮不能被引用为分叉点 */
  running: boolean
  onFork?: (turnId: string, ordinal: number) => void
  onApprovePlan?: (steps: string[]) => void
  onCancelPlan?: () => void
  planDisabled?: boolean
  onSuggestion?: (action: SuggestionAction) => void
  registerRef: (id: string, el: HTMLDivElement | null) => void
}) {
  const failed = turnMeta?.status === 'failed' || turnMeta?.status === 'interrupted'
  // codex 的 fork 只认已结束的轮;正在跑的那轮(或状态仍是 inProgress 的)不给入口
  const forkable = !!group.turnId && !!onFork && !running && turnMeta?.status !== 'inProgress'
  return (
    // 没有 turnId 的是「不属于任何轮」的消息(旧会话、前端合成卡片):
    // 不给它们套轮容器的左边框,否则旧会话的观感会和迁移前不一样
    <div className={group.turnId ? 'group/turn border-l border-border/40 pl-3' : 'group/turn'}>
      {/* 轮标题:有 turnId 才显示(前端合成的卡片不构成一轮) */}
      {group.turnId && (
        <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground/70">
          <span className="font-mono">第 {ordinal} 轮</span>
          {turnMeta?.durationMs != null && <span>{(turnMeta.durationMs / 1000).toFixed(1)}s</span>}
          {failed && (
            <span className="text-red-400">
              {turnMeta?.status === 'interrupted' ? '已中断' : '失败'}
            </span>
          )}
          {forkable && (
            <button
              onClick={() => onFork!(group.turnId!, ordinal)}
              className="ml-auto flex items-center gap-1 rounded border border-border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/turn:opacity-100"
              title={`在此轮之后分叉(保留前 ${ordinal} 轮上下文)`}
            >
              <GitFork className="h-3 w-3" />
              在此分叉
            </button>
          )}
        </div>
      )}
      <div className="space-y-3">
        {group.blocks.map((block) => {
          if (block.kind === 'tools') {
            return (
              <div key={`tools-${block.items[0].id}`}>
                <ToolRunCard items={block.items} repo={repo} />
              </div>
            )
          }
          const msg = block.msg
          return (
            <div key={msg.id} data-message-id={msg.id} ref={(el) => registerRef(msg.id, el)}>
              <MessageCard
                message={msg}
                repo={repo}
                onApprovePlan={onApprovePlan}
                onCancelPlan={onCancelPlan}
                planDisabled={planDisabled}
                onSuggestion={onSuggestion}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 用户提问卡片
 *
 * `injected` 是早期 Flydex 把项目规范拼进 prompt 留下的历史包袱:注入块在提问**前面**,
 * 而「文件全文在哪结束」无法从数据推断,所以不切割、只折叠成一行 —— 展开即可看到原文。
 * 新会话不再产生这种消息。
 */
function UserMessageCard({ message }: { message: CodexMessage }) {
  const injected = hasInjectedContext(message.content)
  const [expanded, setExpanded] = useState(false)
  const timeStr = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (injected && !expanded) {
    return (
      <div className="flex justify-end">
        <button
          onClick={() => setExpanded(true)}
          className="my-1 flex max-w-[80%] items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          title="这段提问里含有早期 Flydex 自动注入的项目规范,已折叠"
        >
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span className="font-medium">含项目规范注入</span>
          <span className="opacity-70">· {message.content.length} 字符 · 点击展开</span>
          <span className="opacity-50">{timeStr}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="flex justify-end">
      <div className="my-1 max-w-[80%] rounded-lg border border-primary/20 bg-primary/10 px-3 py-2">
        <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <User className="h-2.5 w-2.5" />
          <span>你</span>
          <span className="opacity-60">{timeStr}</span>
          {injected && (
            <button
              onClick={() => setExpanded(false)}
              className="ml-1 rounded px-1 hover:bg-accent"
              title="折叠注入的项目规范"
            >
              折叠注入
            </button>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words text-sm">{message.content}</div>
      </div>
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
  // tool 卡片默认折叠(Claude Code 风格):避免长输出撑爆消息流
  const [toolExpanded, setToolExpanded] = useState(false)
  // reasoning(thinking)卡片展开状态 —— 必须在顶层声明(不能放在 if 分支内,否则违反 hooks 规则)
  const [reasoningExpanded, setReasoningExpanded] = useState(false)
  // tool 完成"叮"动画:store 的 lastToolCompleteAt 变化时,如果时间戳匹配就闪一下
  const lastToolCompleteAt = useCodexStore((s) => s.lastToolCompleteAt)
  const [justCompleted, setJustCompleted] = useState(false)
  useEffect(() => {
    if (message.kind !== 'tool' || lastToolCompleteAt === 0) return
    // message.timestamp 应在 lastToolCompleteAt 之后很短时间内(appendMessage 紧随 setState)
    const dt = message.timestamp - lastToolCompleteAt
    if (dt < 500 && dt > -500) {
      setJustCompleted(true)
      const t = setTimeout(() => setJustCompleted(false), 900)
      return () => clearTimeout(t)
    }
  }, [lastToolCompleteAt, message.timestamp, message.kind])

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

  // 用户提问(迁移后首次出现 —— 以前 Flydex 从不持久化用户输入)
  if (message.kind === 'user') {
    return <UserMessageCard message={message} />
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

  // 子代理活动(对齐 Claude Code:缩进 + 左侧竖线,与主消息流区分)
  if (message.kind === 'subagent') {
    return (
      <div className="my-0.5 ml-6 border-l-2 border-cyan-500/40 pl-3">
        <div className="flex items-center gap-1.5 text-[11px] text-cyan-300/80">
          <Users className="h-3 w-3 shrink-0" />
          <span className="font-medium">Subagent</span>
          <span
            className="min-w-0 flex-1 truncate font-mono text-cyan-200/70"
            title={message.content}
          >
            {message.content}
          </span>
          <span className="shrink-0 text-[10px] opacity-50">
            <Clock className="h-2.5 w-2.5 inline" /> {timeStr}
          </span>
        </div>
      </div>
    )
  }

  // Claude Code 风格 thinking 卡片:默认折叠,显示"Thinking for Xs · N chars",展开看完整内容
  if (message.kind === 'reasoning') {
    const charCount = message.content.length
    return (
      <div className="my-1 border-l-2 border-purple-500/40 bg-purple-500/5 py-1 pl-3">
        <button
          onClick={() => setReasoningExpanded(!reasoningExpanded)}
          className="flex w-full items-center gap-1.5 text-left text-xs text-purple-300/80 hover:text-purple-200"
        >
          {reasoningExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <Brain className="h-3 w-3 shrink-0" />
          <span className="font-medium">Thinking</span>
          <span className="text-purple-300/60">· {charCount} chars</span>
          <span className="ml-auto text-[10px] opacity-50">
            <Clock className="h-2.5 w-2.5" />
            {timeStr}
          </span>
        </button>
        {reasoningExpanded && (
          <div className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-black/20 p-2 font-mono text-[11px] leading-relaxed text-purple-200/80">
            {message.content}
          </div>
        )}
      </div>
    )
  }

  // 工具调用卡片：Claude Code 风格 —— 默认折叠,头部只显示命令摘要
  if (message.kind === 'tool') {
    // 完成瞬间的"叮"动画(0 token,纯 UI 反馈)
    // 提取首行命令(去掉时间徽章/输出部分),长命令截断
    const rawCmdLine = (message.content.split('\n')[0] ?? '').trim()
    // 去壳前缀:把 powershell.exe -Command '<真实命令>' / cmd.exe /c '<真实命令>' 还原成真实命令
    const cmdLine = rawCmdLine
      .replace(/^\$\s*/, '')
      .replace(/^"[^"]*(?:powershell|pwsh)\.exe"\s+-Command\s+(['"])(.+?)\1$/i, '$2')
      .replace(/^cmd(?:\.exe)?\s+\/c\s+(['"])(.+?)\1$/i, '$2')
      .replace(/^"[^"]*(?:powershell|pwsh)\.exe"\s+-Command\s+(.+)$/i, '$1')
      .replace(/^cmd(?:\.exe)?\s+\/c\s+(.+)$/i, '$1')
    const cmdDisplay = cmdLine.length > 80 ? cmdLine.slice(0, 77) + '…' : cmdLine
    // 完整内容行数(用于头部摘要,Claude Code 风格:"Used Read (5 lines)")
    const lineCount = message.content.split('\n').length
    // 结果首行 preview(从 message.content 第二行起的输出提取),帮助用户在折叠状态下
    // 一眼看出 AI 拿到了什么 —— 类似 Claude Code 的"Used Read (showing first line)"
    const resultPreview = (() => {
      const lines = message.content.split('\n').slice(1)
      // 过滤空行 + 时间徽章行(如 " · 5.1s")
      const cleaned = lines.filter((l) => {
        const t = l.trim()
        if (!t) return false
        if (/^·\s*[\d.]+s\s*$/.test(t)) return false
        return true
      })
      if (cleaned.length === 0) return ''

      // 智能 preview(按命令类型区分):
      // 1) here-string 写入(如 `$var = @"..."`):第一行是 @" 标记,内容从 cleaned[0] 开始
      const cmdFirstLine = (message.content.split('\n')[0] ?? '').trim()
      const isHeredocWrite = /^\$\w+\s*=\s*@["']/.test(cmdFirstLine)
      if (isHeredocWrite) {
        const content = cleaned[0]
        return content.length > 60 ? content.slice(0, 57) + '…' : content
      }
      // 2) list 类命令:首行通常是列标题(无意义),显示条目数
      if (/Get-ChildItem|^\s*ls\b|\bdir\b/i.test(cmdLine)) {
        return `→ ${cleaned.length} 项`
      }
      // 3) 默认:首行内容(读文件 / grep 等)
      const t = cleaned[0]
      return t.length > 60 ? t.slice(0, 57) + '…' : t
    })()
    return (
      <div className={`rounded py-0.5 ${justCompleted ? 'animate-complete-glow' : ''}`}>
        <button
          onClick={() => setToolExpanded(!toolExpanded)}
          className="flex w-full min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {toolExpanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          {/* Claude Code 风格:tool 卡片创建于工具完成时,故始终显示绿点;
              刚完成瞬间加一次缩放动画(justCompleted) */}
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full bg-green-500 ${
              justCompleted ? 'animate-check-pop' : ''
            }`}
            title="已完成"
          />
          {kindIcons.tool}
          <span className="shrink-0 capitalize">Tool</span>
          {message.toolName && (
            <span className="shrink-0 font-mono text-blue-400">· {message.toolName}</span>
          )}
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80"
            title={cmdLine}
          >
            {cmdDisplay}
          </span>
          {/* Claude Code 风格:折叠状态下显示结果首行,让用户立刻知道 AI 拿到/做了什么 */}
          {resultPreview && !toolExpanded && (
            <span
              className="hidden min-w-0 max-w-[40%] truncate text-[10px] text-muted-foreground/80 md:inline"
              title={resultPreview}
            >
              → {resultPreview}
            </span>
          )}
          <span className="shrink-0 text-[10px] text-muted-foreground/60">{lineCount} 行</span>
          {/* 耗时徽章 */}
          {message.durationMs != null && (
            <span className="shrink-0 rounded bg-muted/50 px-1 py-px font-mono text-[10px] text-muted-foreground">
              {(message.durationMs / 1000).toFixed(2)}s
            </span>
          )}
        </button>
        {toolExpanded && (
          <div className="mt-1 space-y-1 pl-4">
            {/* 完整输出(含命令和原始文本)—— Claude Code 风格:展开后一次性看到所有 */}
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-xs leading-relaxed text-foreground/90">
              {message.content}
            </pre>
            {message.toolArgs != null && (
              <details className="group">
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
        <Markdown content={message.content} />
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
  const [initResumeState, setInitResumeState] = useState<InitStateData | null>(null)

  // 本会话累计的文件变更数。注意:接受/回滚状态在 FileChangeCard 内部(未上提),
  // 故这里统计的是「累计变更数」而非「待处理数」,文案据此措辞。
  // useMemo:ChatPanel 在运行期会随输出节流频繁重渲染,避免每次都扫全量 messages。
  const fileChangeCount = useMemo(
    () =>
      messages.reduce(
        (n, m) => n + (m.kind === 'file_change' ? (m.fileChanges?.length ?? 0) : 0),
        0,
      ),
    [messages],
  )
  const [showSubagent, setShowSubagent] = useState(false)
  const [showTaskPanel, setShowTaskPanel] = useState(false)
  // 注:输入相关本地 state(command / attachments / dragOver 等)已下放到 InputBox 子组件,
  // 这样 keystroke 不会触发整个消息列表 re-render(性能优化)
  const messagesRef = useRef<HTMLDivElement>(null)
  // 用 React ref Map 收集 message DOM 元素(替代 querySelector,更可靠)
  const messageRefsMap = useRef<Map<string, HTMLElement>>(new Map())

  // 搜索结果跳转:监听 store 中的 pendingScrollToMessageId,等 messages 数组真包含目标 ID 后滚动
  // 关键:messages 是 useCodexSession 状态,异步加载(先清空再填)。
  // 用 messages.find 验证目标 ID 已加载,再用 ref Map 找 DOM 节点
  const pendingScrollToMessageId = useCodexStore((s) => s.pendingScrollToMessageId)
  // 同时监听会话变化,新会话加载时重置滚动位置 / 播切换动画
  const currentThreadId = useProjectStore((s) => s.currentThreadId)
  const currentSessionId = useProjectStore((s) => s.currentSessionId)

  // session 切换流畅动画:切会话时先 opacity=0,200ms 后恢复 1
  const [switchFading, setSwitchFading] = useState(false)
  useEffect(() => {
    if (!currentThreadId) return
    setSwitchFading(true)
    const t = setTimeout(() => setSwitchFading(false), 200)
    return () => clearTimeout(t)
  }, [currentThreadId])

  /**
   * 正在看的是迁移前的旧会话(只读)
   *
   * 判据:有旧会话 id 但没有当前线程 —— 两者互斥,一个就够说明问题。
   */
  const readOnlyLegacy = !currentThreadId && !!currentSessionId

  // 更早历史的分页游标 + thread 元信息(轮标题/耗时/失败态)
  const turnsCursor = useCodexStore((s) => s.turnsCursor)
  const turnMetas = useCodexStore((s) => s.turns)
  const loadEarlierTurns = useProjectStore((s) => s.loadEarlierTurns)
  const turnMetaById = useMemo(() => new Map(turnMetas.map((t) => [t.id, t])), [turnMetas])

  // AI 活动状态 banner(对齐 Claude Code:实时显示"思考中/正在响应/运行命令"+ 计时)
  const aiStatus = useCodexStore((s) => s.status)
  const aiLive = useCodexStore((s) => s.live)
  const aiRunningCommands = useCodexStore((s) => s.runningCommands)
  const [elapsedSec, setElapsedSec] = useState(0)
  useEffect(() => {
    if (aiStatus !== 'running') {
      setElapsedSec(0)
      return
    }
    const start = Date.now()
    setElapsedSec(0)
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000))
    }, 500)
    return () => clearInterval(timer)
  }, [aiStatus])
  useEffect(() => {
    // 切会话 → 立即重置 scroll 位置到顶部(防止显示旧会话的滚动状态)
    if (messagesRef.current) {
      messagesRef.current.scrollTop = 0
    }
    // 切会话后清空 ref map(旧 message DOM 引用失效)
    messageRefsMap.current.clear()
  }, [currentThreadId])
  useEffect(() => {
    if (!pendingScrollToMessageId) return
    let cancelled = false
    let attempt = 0
    const maxAttempts = 50 // 50 × 100ms = 5 秒
    const tryScroll = () => {
      if (cancelled) return
      attempt += 1
      // 1) 验证目标 message 已在 messages 数组中(不是空数组)
      const inState = messages.some((m) => m.id === pendingScrollToMessageId)
      // 2) 验证 DOM 渲染完成(用 ref Map,比 querySelector 更可靠)
      const el = messageRefsMap.current.get(pendingScrollToMessageId)
      if (inState && el) {
        // 找到目标!滚动到该 message
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ring-2', 'ring-blue-500/60', 'rounded-md')
        setTimeout(() => el.classList.remove('ring-2', 'ring-blue-500/60', 'rounded-md'), 2000)
        useCodexStore.getState().setPendingScrollToMessageId(null)
        return
      }
      if (attempt < maxAttempts) {
        setTimeout(tryScroll, 100)
      } else {
        useCodexStore.getState().setPendingScrollToMessageId(null)
      }
    }
    // 立即 scrollTop=0 + 启动轮询
    if (messagesRef.current) messagesRef.current.scrollTop = 0
    const timer = setTimeout(tryScroll, 50)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [pendingScrollToMessageId, messages])

  const threads = useProjectStore((s) => s.threads)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const workspaceCwd = useWorkspaceStore((s) => s.cwd)
  const modelConfig = useModelStore((s) => s.config)
  const loadModels = useModelStore((s) => s.load)
  // 7.2.3 后台子代理运行数徽章
  const subagentRunning = useSubagentStore((s) => s.backgroundRunning)

  // 当前会话的 codex 记录(标题与 cwd 都来自它 —— 遵循 codex"会话绑定创建时的 cwd")
  const currentThread = useMemo(
    () => threads.find((t) => t.id === currentThreadId) ?? null,
    [threads, currentThreadId],
  )
  const currentThreadWorkdir = currentThread?.cwd
  // 会话级模型覆盖(持久化在 ~/.flydex/thread_settings.json)
  const threadModel = useProjectStore((s) => s.currentThreadModel)
  const setThreadModel = useProjectStore((s) => s.setThreadModel)
  const exportSession = useProjectStore((s) => s.exportSession)
  const lastUserInput = useRef<string>('')

  /** 7.4.3 消息级分叉：在指定消息后 fork 新会话（并行时间线入口） */
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

  // 项目切换时检查 init 状态(用于"上次的 init 进行到 X,继续?" banner)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const state = await initStateService.get(workspaceCwd)
        if (cancelled) return
        if (state && state.step !== 'done' && state.step !== 'idle') {
          setInitResumeState(state)
        } else {
          setInitResumeState(null)
        }
      } catch {
        // 静默:没文件或后端失败
        if (!cancelled) setInitResumeState(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceCwd])

  // 自动滚动到底部（消息变化或打字机推进时）
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages, aiLive?.text])

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
        if (currentThreadWorkdir || workspaceCwd) {
          const workdir = currentThreadWorkdir || workspaceCwd
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
              threadModel,
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
          await run(lastUserInput.current, currentThreadWorkdir || workspaceCwd, threadModel)
        } else {
          useCodexStore.getState().appendOutput({ text: '没有可重跑的上一次输入', kind: 'system' })
        }
        break
      case 'export': {
        // 导出当前会话为 Markdown 并下载。
        // 优先走 codex 线程(那是迁移后的主路径);只有在看只读旧会话时才走旧通道。
        const project = useProjectStore.getState()
        const tid = project.currentThreadId
        const sid = project.currentSessionId
        try {
          let content: string
          let name: string
          if (tid) {
            content = await project.exportThread(tid, 'markdown')
            name = `thread-${tid.slice(0, 8)}`
          } else if (sid) {
            content = await exportSession(sid, 'markdown')
            name = `session-${sid}`
          } else {
            break
          }
          const blob = new Blob([content], { type: 'text/markdown' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${name}.md`
          a.click()
          URL.revokeObjectURL(url)
          useCodexStore.getState().appendOutput({ text: '已导出 Markdown', kind: 'system' })
        } catch (e) {
          useCodexStore.getState().appendOutput({ text: `导出失败: ${String(e)}`, kind: 'stderr' })
        }
        break
      }
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

      // /init 命令:对齐 Claude Code 风格 —— 不弹窗,直接让 AI 自主决策
      // 1. 扫描项目 → InitReport
      // 2. 根据 scenario + 检测到的文件,构造 init prompt 让 AI 自主选择动作
      //    - A(已有规范): 不动,告知用户已存在
      //    - B(有文档无规范): 直接读需求+技术,生成 AGENTS.md
      //    - C(仅骨架): 读 README.md,通过对话引导用户补全需求/技术文档
      //    - D(全新): 引导用户从零开始建立需求/技术文档
      if (cmd.trim() === '/init' || cmd.trim().startsWith('/init ')) {
        try {
          const report = await initService.scan(workspaceCwd)
          // 构造 init 上下文 prompt(注入到 finalCommand,跟普通对话走同样的发送流程)
          const fileList = report.candidates
            .map((c) => `- ${c.path}(${c.size_bytes} 字节)`)
            .join('\n')
          const scenarioGuide: Record<typeof report.scenario, string> = {
            A: '项目已有规范文件(AGENTS.md / CLAUDE.md),**不要覆盖**。读取现有内容告知用户已存在,**不创建任何文件**。',
            B: '项目有需求/技术文档但无规范。**核心任务:生成 AGENTS.md**。请用 read_file 工具读取 requirements.md 和 tech-spec.md(最多 3 次 read),然后直接生成 AGENTS.md(YAML frontmatter + Markdown body,必填字段:project.name / project.description / stack.languages / build.command / build.test / conventions.naming / workflow.commit)。',
            C: '项目已有骨架(README / build 文件),但无规范/需求/技术文档。**核心任务:通过对话引导用户补全 requirements.md → tech-spec.md → AGENTS.md**。先 read_file README.md 1 次,理解项目后开始多轮对话。',
            D: '全新项目。**核心任务:通过对话引导用户从零建立 requirements.md → tech-spec.md → AGENTS.md**。每写完一个文件,让用户确认后输入 /done 进入下一步。',
          }
          cmd = `你刚收到 /init 命令。**核心目标:让 AI 未来更懂项目,产物是 AGENTS.md / requirements.md / tech-spec.md**(注意:不是 README/LICENSE/CONTRIBUTING.md)。

项目根目录扫描结果:
- 场景: ${report.scenario}(${report.scenario_label})
- git 仓库: ${report.has_git ? '是' : '否'}
- README: ${report.has_readme ? '有' : '无'}

检测到的文件:
${fileList || '(空目录)'}

推荐操作:
${scenarioGuide[report.scenario]}

**重要约束**:
1. **不要创建 README.md / LICENSE / CONTRIBUTING.md**(不是 init 的职责)
2. **不要弹窗询问用户**"你要怎么做"——直接根据上面的推荐采取行动
3. read_file 次数限制 ≤ 3(避免重复读)
4. 完成后在回复里报告做了什么,**核心产物是 AGENTS.md**
5. 完成后请告诉用户输入 \`/done\` 推进 init state

你可以使用 file_read / file_edit / shell 等工具完成工作。`
          // 更新 init state(scanned,作为持久化状态机的中间步骤)
          await initStateService.set(workspaceCwd, report.scenario, 'scanned')
          useCodexStore.getState().appendOutput({
            text: `[init] 已扫描 ${workspaceCwd} (场景 ${report.scenario}),AI 接管中…`,
            kind: 'system',
          })
        } catch (e) {
          useCodexStore.getState().appendOutput({
            text: `[init] 扫描失败: ${String(e)}`,
            kind: 'stderr',
          })
          return
        }
      }

      // /requirements /tech-spec /spec /done 子命令:引导 init 流程
      // 阶段 3 增强:写模板 + 更新 init state,AI 用 file_edit 工具在多轮对话中完善内容
      const trimmedCmd = cmd.trim()
      const slashMatch = trimmedCmd.match(/^\/(requirements|tech-spec|spec|done)(?:\s+(.*))?$/)
      if (slashMatch) {
        const subcmd = slashMatch[1]
        const userInput = slashMatch[2]?.trim() ?? ''
        void userInput
        try {
          if (subcmd === 'requirements') {
            const template = `# 项目需求文档

> 由 Flydex \`/requirements\` 命令生成,AI 在多轮对话中自动完善。

## 1. 项目目标
<!-- 项目核心目标:要解决什么问题 -->

## 2. 用户场景
<!-- 谁会用这个项目?典型使用场景? -->

## 3. 功能需求
<!-- 主要功能列表,优先级 P0/P1/P2 -->

## 4. 非功能需求
<!-- 性能/安全/兼容性 -->

## 5. 验收标准
<!-- 怎么算"做完了"? -->
`
            await initService.writeFile(workspaceCwd, 'requirements.md', template, false)
            await initStateService.set(workspaceCwd, 'D', 'collecting-requirements')
            setInitResumeState(null) // 触发 useEffect 重新检查
            useCodexStore.getState().appendOutput({
              text: '[init] 已创建 requirements.md 模板。继续对话告诉 AI 需求细节。完成后输入 /done 进入下一步。',
              kind: 'system',
            })
            return
          } else if (subcmd === 'tech-spec') {
            const template = `# 技术规格说明书

> 由 Flydex \`/tech-spec\` 命令生成。

## 1. 技术栈
<!-- 语言/框架/运行时 -->

## 2. 架构设计
<!-- 模块划分/数据流 -->

## 3. 接口定义
<!-- 关键 API/数据模型 -->

## 4. 存储设计
<!-- 数据库/文件/缓存 -->

## 5. 部署/构建
<!-- 如何构建/运行/部署 -->
`
            await initService.writeFile(workspaceCwd, 'tech-spec.md', template, false)
            await initStateService.set(workspaceCwd, 'D', 'collecting-tech-spec')
            setInitResumeState(null)
            useCodexStore.getState().appendOutput({
              text: '[init] 已创建 tech-spec.md 模板。继续对话告诉 AI 技术细节。完成后输入 /done 进入下一步。',
              kind: 'system',
            })
            return
          } else if (subcmd === 'spec') {
            // /spec:让 AI 基于现有文档生成 AGENTS.md(实际生成由 AI 在对话中完成)
            cmd = `请阅读 ${workspaceCwd} 下的 requirements.md 和 tech-spec.md(如不存在请说明),然后生成 AGENTS.md(YAML frontmatter + Markdown,包含项目名/描述/技术栈/构建命令/命名规范/提交规范/测试要求)。`
            await initStateService.set(workspaceCwd, 'D', 'ready-to-generate')
            setInitResumeState(null)
          } else if (subcmd === 'done') {
            // /done:推进 init 状态到下一步(根据当前 step)
            const state = await initStateService.get(workspaceCwd)
            if (!state) {
              useCodexStore.getState().appendOutput({
                text: '[init] 没有进行中的 init 流程',
                kind: 'stderr',
              })
              return
            }
            let nextStep:
              'collecting-requirements' | 'collecting-tech-spec' | 'ready-to-generate' | 'done' =
              'done'
            let nextLabel = '全部完成'
            if (state.step === 'collecting-requirements') {
              nextStep = 'collecting-tech-spec'
              nextLabel = '请运行 /tech-spec 生成技术文档模板'
            } else if (state.step === 'collecting-tech-spec') {
              nextStep = 'ready-to-generate'
              nextLabel = '请运行 /spec 生成 AGENTS.md'
            } else if (state.step === 'ready-to-generate') {
              nextStep = 'done'
              nextLabel = 'init 完成'
            } else if (state.step === 'done') {
              nextStep = 'done'
              nextLabel = 'init 已完成'
            }
            await initStateService.set(workspaceCwd, state.scenario, nextStep)
            setInitResumeState(null)
            useCodexStore.getState().appendOutput({
              text: `[init] 推进到下一步:${nextLabel}`,
              kind: 'system',
            })
            return
          }
        } catch (e) {
          useCodexStore.getState().appendOutput({
            text: `[init] ${subcmd} 失败: ${String(e)}`,
            kind: 'stderr',
          })
          return
        }
      }

      // 记录本次用户输入（"再跑一次" 建议会用到）
      lastUserInput.current = cmd

      // 新会话刻意**不在此建 thread**:首条消息发出后 codex 自己建,轮结束时会话
      // 自动出现在侧边栏(标题取自首条消息的 preview)。也不再需要 Flydex 手工改名。

      // 遵循 codex：resume 会话用会话绑定的 cwd，新会话用全局 cwd；模型用会话级覆盖（无则全局默认）
      // 计划模式开启时 mode='plan'（后端强制 read-only 沙箱 + 注入计划指令）
      const planModeActive = useCodexStore.getState().planMode
      const workdir = currentThreadWorkdir || workspaceCwd

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
          await run(prompt, workdir, threadModel, 'review')
          await invoke('remove_review_diff', { repo: workdir }).catch(() => {})
          return
        } catch (e) {
          useCodexStore.getState().appendOutput({ text: `审查失败: ${String(e)}`, kind: 'stderr' })
          return
        }
      }

      // 收集已落盘的图片附件路径(从当前 InputBox 内部状态不可见,但 attachments 中已有 path)
      const imagePaths = _attachments.map((a) => a.path).filter(Boolean)
      run(finalCmd, workdir, threadModel, planModeActive ? 'plan' : undefined, imagePaths)
    },
    [status, currentThreadWorkdir, threadModel, workspaceCwd, run],
  )

  // 切模型:只记偏好,不新建 thread —— 每轮 resume 都会把新 config 下发给 codex,
  // 不需要靠"换模型=换会话"来绕开跨模型 resume 的警告(旧 hack 已删)
  // 轮序号(按 codex 的轮顺序,不受分页影响)
  const turnOrdinal = useCallback(
    (turnId?: string) => {
      if (!turnId) return 0
      const idx = turnMetas.findIndex((t) => t.id === turnId)
      return idx >= 0 ? idx + 1 : 0
    },
    [turnMetas],
  )

  const handleForkAtTurn = useCallback((turnId: string, ordinal: number) => {
    const ok = window.confirm(
      `在此轮(第 ${ordinal} 轮)之后分叉出新会话?
将复制到该轮为止的完整上下文。`,
    )
    if (!ok) return
    void useProjectStore.getState().forkThreadAtTurn(turnId)
  }, [])

  const handleModelChange = (modelId: string) => {
    void setThreadModel(modelId === '__global__' ? null : modelId)
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
            value={threadModel ?? '__global__'}
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
            workdir={currentThreadWorkdir || workspaceCwd}
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
      <div
        ref={messagesRef}
        className={`flex-1 overflow-y-auto p-4 transition-opacity duration-200 ${
          switchFading ? 'opacity-0' : 'opacity-100'
        }`}
      >
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
            {/* 更早的历史:codex 的 turns 是分页的,按需往前翻 */}
            {turnsCursor && (
              <div className="flex justify-center">
                <button
                  onClick={() => void loadEarlierTurns()}
                  className="rounded border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  加载更早的对话
                </button>
              </div>
            )}
            {/* 结构化消息:按轮分组,组内把连续的工具调用合并为一段 */}
            {buildTurnGroups(messages).map((group, gi, groups) => (
              <TurnBlockView
                key={group.key}
                group={group}
                turnMeta={group.turnId ? turnMetaById.get(group.turnId) : undefined}
                ordinal={turnOrdinal(group.turnId)}
                // 只在跑的时候把最后一轮当进行中:历史里的 inProgress 由 turnMeta 判定
                running={status === 'running' && gi === groups.length - 1}
                onFork={handleForkAtTurn}
                repo={currentThreadWorkdir || workspaceCwd}
                onApprovePlan={approvePlan}
                onCancelPlan={cancelPlan}
                planDisabled={status === 'running'}
                onSuggestion={handleSuggestionAction}
                registerRef={(id, el) => {
                  if (el) messageRefsMap.current.set(id, el)
                  else messageRefsMap.current.delete(id)
                }}
              />
            ))}

            {/* 流式实时预览:直接来自 codex 的 delta 通知。
                正式消息落地后 clearLive() 会移除本块,由真实消息取代(文本连续)。 */}
            {aiLive && aiLive.text && (
              <div
                className={
                  aiLive.kind !== 'agent'
                    ? 'border-l-2 border-purple-500/40 bg-purple-500/5 py-2 pl-3'
                    : 'border-l-2 border-green-500 bg-green-500/5 py-2 pl-3'
                }
              >
                <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {aiLive.kind !== 'agent' ? (
                    <>
                      <Brain className="h-3 w-3 text-purple-400" />
                      <span>
                        {aiLive.kind === 'reasoning-summary' ? 'Thinking…' : 'Thinking (raw)…'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3 text-green-400" />
                      <span>Responding…</span>
                    </>
                  )}
                  <span className="ml-auto flex items-center gap-0.5 text-[10px] opacity-50">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    {aiLive.text.length} chars
                  </span>
                </div>
                {aiLive.kind !== 'agent' ? (
                  // 思考:原文可能长达数千字符,只露出尾部若干行(顶部渐隐),
                  // 完整内容仍保留在完成后的可展开卡片里 —— 对齐 Claude Code 的"只显示部分"
                  <div className="relative max-h-24 overflow-hidden">
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background to-transparent" />
                    <div className="whitespace-pre-wrap pt-3 font-mono text-[11px] leading-relaxed text-purple-200/80">
                      {aiLive.text.length > THINKING_TAIL_CHARS
                        ? '…' + aiLive.text.slice(-THINKING_TAIL_CHARS)
                        : aiLive.text}
                    </div>
                  </div>
                ) : (
                  <Markdown content={aiLive.text} />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI 活动状态 banner(对齐 Claude Code 实时状态显示) */}
      {aiStatus === 'running' && (
        <div className="flex items-center gap-2 border-t border-blue-500/30 bg-blue-500/5 px-3 py-1.5 text-xs text-blue-300">
          {aiLive ? (
            <>
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400" />
              <span className="font-medium">正在响应</span>
              <span className="text-blue-300/70">· {elapsedSec}s</span>
              <span className="ml-auto text-[10px] text-blue-300/60">
                ↑ {aiLive.text.length} chars
              </span>
            </>
          ) : aiRunningCommands.length > 0 ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="font-medium">运行命令</span>
              <span className="font-mono text-blue-300/80">↑ {aiRunningCommands[0].command}</span>
              <span className="text-blue-300/70">· {elapsedSec}s</span>
            </>
          ) : (
            <>
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400" />
              <span className="font-medium">思考中</span>
              <span className="text-blue-300/70">· {elapsedSec}s</span>
              <span className="ml-auto text-[10px] text-blue-300/60">等待响应…</span>
            </>
          )}
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
        defaultWorkdir={currentThreadWorkdir || workspaceCwd}
        defaultModel={threadModel}
      />

      {/* 任务面板（v4.2） */}
      <TaskPanel
        open={showTaskPanel}
        onClose={() => setShowTaskPanel(false)}
        projectId={currentProjectId}
        sessionId={currentThreadId}
      />

      {/* 记忆管理面板（v4.1） */}
      <MemoryPanel
        workdir={currentThreadWorkdir || workspaceCwd}
        open={showMemoryPanel}
        onClose={() => setShowMemoryPanel(false)}
      />

      {/* 模型任务清单(codex 原生 turn/plan/updated) */}
      <TurnPlanPanel />

      {/* 输入区域 —— 拆为独立子组件(性能优化) */}
      {/* 文件变更导航 banner(对齐 Claude Code 的 diff 可见性) */}
      {fileChangeCount > 0 && (
        <button
          onClick={() => {
            // 滚动到第一个 file_change 卡片
            const firstFileChange = document.querySelector(
              '[data-file-change="true"]',
            ) as HTMLElement | null
            if (firstFileChange) {
              firstFileChange.scrollIntoView({ behavior: 'smooth', block: 'center' })
              // 高亮一下
              firstFileChange.classList.add('ring-2', 'ring-amber-500/60')
              setTimeout(
                () => firstFileChange.classList.remove('ring-2', 'ring-amber-500/60'),
                1500,
              )
            }
          }}
          className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-left text-xs text-amber-300 transition-colors hover:bg-amber-500/20"
          title="点击跳到第一个文件变更卡片"
        >
          <span className="font-medium">📋 {fileChangeCount} 个文件变更</span>
          <span className="text-[10px] text-amber-300/70">
            点击跳到第一个变更卡片,接受/回滚在卡片内操作
          </span>
        </button>
      )}
      {/* 旧会话(只读):它的内容不在 codex 里,发消息会静默新建一个会话 ——
          与其让用户困惑,不如直接说明并禁用输入 */}
      {readOnlyLegacy ? (
        <div className="border-t border-border bg-muted/20 px-4 py-3 text-center text-xs text-muted-foreground">
          这是迁移前的旧会话,仅作只读归档 —— 它没有保存过你的提问,无法继续对话。
          <br />
          要接着聊,请点侧边栏的 <span className="font-medium">+</span> 新建会话。
        </div>
      ) : (
        <InputBox
          status={status}
          threadId={threadId}
          approval={approval}
          respondApproval={respondApproval}
          onSend={handleSend}
          currentSessionWorkdir={currentThreadWorkdir}
          workspaceCwd={workspaceCwd}
          planMode={planMode}
        />
      )}

      {/* init 流程恢复 banner —— 项目切换时检测 .flydex/init-state.json,
          显示"上次的 init 进行到 X,继续?"让用户感知状态 */}
      {initResumeState && (
        <div className="border-t border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <span className="font-medium">📋 检测到未完成的 init 流程</span>
            <span className="text-amber-300/80">
              步骤:<span className="font-mono">{getInitStepLabel(initResumeState.step)}</span>
            </span>
            <span className="text-amber-300/60">场景:{initResumeState.scenario}</span>
            {initResumeState.written_files.length > 0 && (
              <span className="hidden text-amber-300/60 sm:inline">
                已写入:{initResumeState.written_files.join(', ')}
              </span>
            )}
            <button
              onClick={async () => {
                // 继续:关闭 banner,保留 state,用户后续 /init 操作会基于这个 state
                setInitResumeState(null)
              }}
              className="ml-auto rounded bg-amber-500/30 px-2 py-0.5 text-amber-200 transition-colors hover:bg-amber-500/50"
            >
              继续
            </button>
            <button
              onClick={async () => {
                try {
                  await initStateService.clear(workspaceCwd)
                  setInitResumeState(null)
                  useCodexStore.getState().appendOutput({
                    text: '[init] 已清除 init 状态,可重新 /init 开始',
                    kind: 'system',
                  })
                } catch (e) {
                  useCodexStore.getState().appendOutput({
                    text: `[init] 清除失败: ${String(e)}`,
                    kind: 'stderr',
                  })
                }
              }}
              className="rounded px-2 py-0.5 text-amber-300 transition-colors hover:bg-amber-500/20"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
