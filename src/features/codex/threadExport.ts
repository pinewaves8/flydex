/**
 * 会话导出(JSON / Markdown)
 *
 * codex 没有导出接口(实测),所以导出由 Flydex 自己渲染 —— 但它渲染的是
 * **同一份映射产物**(`threadItems.turnsToMessages`),不另写一套 item 解析,
 * 否则导出的内容迟早和界面显示的不一致。
 *
 * 纯函数,不依赖 Tauri / store,便于单测与复用。
 */

import type { CodexMessage } from '@/types/codexJson'
import type { ThreadRow } from '@/types/thread'
import { threadTitle } from '@/types/thread'

/** 导出格式 */
export type ExportFormat = 'json' | 'markdown'

function formatTs(ms: number): string {
  if (!ms) return '-'
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

/** 消息在导出里的可读标签 */
function kindLabel(m: CodexMessage): string {
  switch (m.kind) {
    case 'user':
      return '你'
    case 'agent':
      return 'Assistant'
    case 'tool':
      return '工具'
    case 'reasoning':
      return '思考'
    case 'file_change':
      return '文件变更'
    case 'subagent':
      return '子代理'
    default:
      return m.kind
  }
}

/**
 * 渲染为 Markdown
 *
 * 版式与旧会话的导出保持一致(标题 + 元信息 + `---` + 逐条),这样两种来源
 * 导出的文件读起来是同一个东西。
 */
export function toMarkdown(thread: ThreadRow, messages: CodexMessage[]): string {
  const out: string[] = []
  out.push(`# ${threadTitle(thread)}\n`)
  out.push(
    [
      `- **会话 ID**: \`${thread.id}\``,
      `- **工作目录**: \`${thread.cwd}\``,
      `- **创建时间**: ${formatTs(thread.createdAt)}`,
      `- **更新时间**: ${formatTs(thread.updatedAt)}`,
      `- **消息数**: ${messages.length}`,
      `- **模型供应商**: \`${thread.modelProvider}\``,
    ].join('\n') + '\n',
  )
  if (thread.forkedFromId) {
    out.push(`- **分叉自**: \`${thread.forkedFromId}\`\n`)
  }
  out.push('---\n')

  messages.forEach((m, i) => {
    out.push(`## ${i + 1}. ${kindLabel(m)} (${formatTs(m.timestamp)})\n`)
    if (m.toolName && m.kind === 'tool') {
      out.push(
        `> 工具: \`${m.toolName}\`${m.durationMs != null ? ` · ${(m.durationMs / 1000).toFixed(1)}s` : ''}\n`,
      )
    }
    if (m.fileChanges?.length) {
      out.push(m.fileChanges.map((c) => `- \`${c.path}\` (${c.kind})`).join('\n') + '\n')
    }
    out.push(m.content + '\n')
  })

  return out.join('\n')
}

/** 渲染为 JSON(保留结构化字段,便于二次处理) */
export function toJson(thread: ThreadRow, messages: CodexMessage[]): string {
  return JSON.stringify(
    {
      thread: {
        id: thread.id,
        title: threadTitle(thread),
        cwd: thread.cwd,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        forkedFromId: thread.forkedFromId,
        modelProvider: thread.modelProvider,
      },
      messages,
    },
    null,
    2,
  )
}

export function renderExport(
  format: ExportFormat,
  thread: ThreadRow,
  messages: CodexMessage[],
): string {
  return format === 'json' ? toJson(thread, messages) : toMarkdown(thread, messages)
}

/** 导出文件的扩展名 / MIME */
export function exportFileMeta(format: ExportFormat): { ext: string; mime: string } {
  return format === 'json'
    ? { ext: 'json', mime: 'application/json' }
    : { ext: 'md', mime: 'text/markdown' }
}
