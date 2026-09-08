import { AlertCircle, CheckCircle2, Clock, Cpu, FileEdit, Plug, Wrench } from 'lucide-react'

import type { TurnStats } from '@/types/codexJson'

/** 格式化耗时（紧凑：1m 23s / 12s / 2h 03m） */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  if (min < 60) return `${min}m ${remSec.toString().padStart(2, '0')}s`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return `${hr}h ${remMin.toString().padStart(2, '0')}m`
}

/** 格式化 token 计数（k 简写） */
function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}

interface TurnSummaryCardProps {
  stats: TurnStats
  timestamp: number
}

/**
 * TurnSummaryCard — 本轮工作总结（仿 Claude Code `★ 工作摘要`）
 *
 * 显示：耗时 / 工具调用 / 文件变更 / token 用量 / 错误徽章
 * 由 useCodexSession 在 turn.completed 自动插入
 */
export function TurnSummaryCard({ stats, timestamp }: TurnSummaryCardProps) {
  const timeStr = new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const totalTokens = stats.inputTokens + stats.outputTokens + stats.reasoningTokens

  return (
    <div
      className={`my-3 flex items-center gap-3 rounded-md border px-3 py-2 text-xs ${
        stats.hadErrors ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-muted/30'
      }`}
    >
      {stats.hadErrors ? (
        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-400" />
      )}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {/* 耗时 */}
        <span className="flex items-center gap-1 font-mono text-foreground">
          <Clock className="h-3 w-3 text-muted-foreground" />
          {formatDuration(stats.durationMs)}
        </span>
        {/* 工具调用 */}
        {stats.toolCalls > 0 && (
          <span className="flex items-center gap-1 text-blue-400">
            <Wrench className="h-3 w-3" />
            {stats.toolCalls} 工具
          </span>
        )}
        {/* MCP 工具 */}
        {stats.mcpCalls > 0 && (
          <span className="flex items-center gap-1 text-sky-400">
            <Plug className="h-3 w-3" />
            {stats.mcpCalls} MCP
          </span>
        )}
        {/* 文件变更 */}
        {stats.fileChanges > 0 && (
          <span className="flex items-center gap-1 text-amber-400">
            <FileEdit className="h-3 w-3" />
            {stats.fileChanges} 文件
          </span>
        )}
        {/* Token */}
        <span className="flex items-center gap-1 text-muted-foreground">
          <Cpu className="h-3 w-3" />
          {formatTokens(totalTokens)} tok
        </span>
        {/* 缓存命中提示 */}
        {stats.cacheReadTokens > 0 && (
          <span className="text-[10px] text-emerald-500/70">
            ♻︎ {formatTokens(stats.cacheReadTokens)}
          </span>
        )}
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground">{timeStr}</span>
    </div>
  )
}
