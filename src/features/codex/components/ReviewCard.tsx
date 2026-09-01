import { Copy, Download, FileSearch } from 'lucide-react'
import { useState } from 'react'

import { parseReviewReport, REVIEW_LEVEL_STYLE } from '../reviewReport'

import type { CodexMessage } from '@/types/codexJson'

interface ReviewCardProps {
  message: CodexMessage
}

export function ReviewCard({ message }: ReviewCardProps) {
  const [report] = useState(() => parseReviewReport(message.content))
  const [copied, setCopied] = useState<string | null>(null)

  const timeStr = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const copyLoc = async (loc: string) => {
    try {
      await navigator.clipboard.writeText(loc)
      setCopied(loc)
      setTimeout(() => setCopied((c) => (c === loc ? null : c)), 1200)
    } catch {
      // clipboard 不可用时忽略
    }
  }

  const exportMd = () => {
    const lines: string[] = []
    lines.push('# 代码审查报告')
    if (report.summary) lines.push(`\n> ${report.summary}`)
    lines.push('')
    if (report.issues.length > 0) {
      report.issues.forEach((it, i) => {
        lines.push(`## ${i + 1}. [${it.level}] ${it.file}:${it.line}`)
        lines.push(`\n${it.summary}`)
        if (it.suggestion) lines.push(`\n**建议**: ${it.suggestion}`)
        lines.push('')
      })
    } else {
      lines.push('_未解析出分级问题，见原文。_')
    }
    if (report.conclusion) lines.push(`\n---\n\n**审查总结**: ${report.conclusion}`)
    lines.push('')
    lines.push('---')
    lines.push('*由 Flydex Code Review 生成*')
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `code-review-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded border border-primary/30 bg-primary/5 py-2 pl-3 pr-2">
      {/* 头部 */}
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-primary">
        <FileSearch className="h-3.5 w-3.5" />
        <span className="font-medium">Code Review · 审查报告</span>
        <span className="ml-auto flex items-center gap-1.5">
          <button
            onClick={exportMd}
            className="flex items-center gap-0.5 rounded border border-primary/30 px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10"
            title="导出为 Markdown"
          >
            <Download className="h-2.5 w-2.5" /> 导出 MD
          </button>
          <span className="text-[10px] opacity-50">{timeStr}</span>
        </span>
      </div>

      {/* 总评 */}
      {report.summary && (
        <div className="mb-1.5 rounded bg-background/50 px-2 py-1 text-xs text-foreground/90">
          {report.summary}
        </div>
      )}

      {/* 问题清单 */}
      {report.issues.length > 0 ? (
        <div className="space-y-1">
          {report.issues.map((it, idx) => {
            const st = REVIEW_LEVEL_STYLE[it.level]
            const loc = `${it.file}:${it.line}`
            return (
              <div key={idx} className="rounded bg-background/40 px-2 py-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`flex items-center gap-0.5 rounded border px-1 py-px text-[10px] font-medium ${st.badge}`}
                  >
                    {<st.icon className="h-3 w-3" />}
                    {st.label}
                  </span>
                  <button
                    onClick={() => copyLoc(loc)}
                    className="flex items-center gap-0.5 rounded px-1 py-px font-mono text-[10px] text-primary hover:bg-primary/10"
                    title="复制 文件:行号"
                  >
                    {loc}
                    <Copy className="h-2.5 w-2.5 opacity-60" />
                  </button>
                  {copied === loc && <span className="text-[10px] text-emerald-400">已复制</span>}
                </div>
                <div className="mt-0.5 text-xs text-foreground">{it.summary}</div>
                {it.suggestion && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    <span className="text-primary/80">建议：</span>
                    {it.suggestion}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="whitespace-pre-wrap text-xs text-foreground/80">{message.content}</div>
      )}

      {/* 审查总结 */}
      {report.conclusion && (
        <div className="mt-1.5 border-t border-border/50 pt-1.5 text-xs text-foreground/85">
          <span className="text-primary/80">审查总结：</span>
          {report.conclusion}
        </div>
      )}
    </div>
  )
}
