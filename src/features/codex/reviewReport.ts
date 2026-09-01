import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** 审查级别 */
export type ReviewLevel = '严重' | '警告' | '建议' | '好评'

/** 单条审查问题 */
export interface ReviewIssue {
  level: ReviewLevel
  file: string
  line: string
  summary: string
  suggestion?: string
}

/** 解析后的审查报告 */
export interface ReviewReport {
  summary: string
  issues: ReviewIssue[]
  conclusion: string
}

/** 容忍列表符号 / 加粗等 markdown 前缀 */
const PREFIX_RE = /^(?:[-*+]\s+|\d+[.)]\s+|[*_]{0,2})/

/** 分隔线 / 纯噪音行（不作为总评或总结兜底） */
const NOISE_RE = /^(?:[-*_=]{3,}|[>\s#`]*)$/

/**
 * 解析审查报告文本 → 结构化报告
 *
 * 模型输出格式（每行一条）：
 *   总评：xxx
 *   级别|文件:行号|问题概述|修改建议
 *   审查总结：xxx
 * 级别取 严重/警告/建议/好评（可带【】）。容忍行首 `- ` / `* ` / `1.` / 加粗等 markdown 前缀。
 */
export function parseReviewReport(content: string): ReviewReport {
  const lines = content
    .split('\n')
    .map((l) => l.replace(/\r$/, '').trim())
    .filter(Boolean)
  const issues: ReviewIssue[] = []
  const seen = new Set<string>()
  let summary = ''
  let conclusion = ''
  for (const raw of lines) {
    const line = raw.replace(PREFIX_RE, '').trim()
    const m = line.match(
      /^[【[]?(严重|警告|建议|好评)(?:】|\])?\s*[|:：]?\s*([^|:：]+?)\s*[:：]\s*(\d+)\s*[|]\s*(.+?)(?:\s*[|]\s*(.+))?$/,
    )
    if (m) {
      const key = m[2].trim() + ':' + m[3] + '|' + m[4].trim()
      if (!seen.has(key)) {
        seen.add(key)
        issues.push({
          level: m[1] as ReviewLevel,
          file: m[2].trim(),
          line: m[3],
          summary: m[4].trim(),
          suggestion: m[5]?.trim(),
        })
      }
      continue
    }
    if (/^总评[:：]/.test(line)) {
      summary = line.replace(/^总评[:：]/, '').trim()
      continue
    }
    if (/^审查总结[:：]/.test(line)) {
      conclusion = line.replace(/^审查总结[:：]/, '').trim()
      continue
    }
    // 其余行忽略（不兜底为总评，避免把模型解释性废话混入）
    void NOISE_RE
  }
  return { summary, issues, conclusion }
}

/** 级别展示配置 */
export const REVIEW_LEVEL_STYLE: Record<
  ReviewLevel,
  { label: string; badge: string; icon: LucideIcon }
> = {
  严重: {
    label: '严重',
    badge: 'bg-red-500/15 text-red-400 border-red-500/30',
    icon: XCircle,
  },
  警告: {
    label: '警告',
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    icon: AlertTriangle,
  },
  建议: {
    label: '建议',
    badge: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    icon: Info,
  },
  好评: {
    label: '好评',
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    icon: CheckCircle2,
  },
}
