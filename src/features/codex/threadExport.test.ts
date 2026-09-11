import { describe, expect, it } from 'vitest'

import { exportFileMeta, renderExport, toJson, toMarkdown } from '@/features/codex/threadExport'
import type { CodexMessage } from '@/types/codexJson'
import type { ThreadRow } from '@/types/thread'

/**
 * 导出没有 codex 侧的接口可用(实测),完全由 Flydex 渲染 —— 所以「导出对不对」
 * 只能靠这里保证。重点盯:内容不丢、版式与旧会话导出一致。
 */

const thread: ThreadRow = {
  id: '01a0-thread',
  name: '修一下登录',
  preview: '首条消息',
  forkedFromId: null,
  parentThreadId: null,
  projectId: 'p1',
  createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
  updatedAt: Date.UTC(2026, 0, 3, 3, 4, 5),
  cwd: 'C:/work',
  historyMode: 'paginated',
  modelProvider: 'flydex_deepseek',
  status: 'idle',
  archived: false,
}

function msg(v: Partial<CodexMessage> & { id: string; kind: CodexMessage['kind'] }): CodexMessage {
  return { content: '', timestamp: Date.UTC(2026, 0, 2, 3, 4, 5), ...v }
}

describe('toMarkdown', () => {
  it('给出标题与元信息,并带分隔线', () => {
    const md = toMarkdown(thread, [])
    expect(md).toContain('# 修一下登录')
    expect(md).toContain('`01a0-thread`')
    expect(md).toContain('`C:/work`')
    expect(md).toContain('---')
  })

  it('用户与助手的标签可读', () => {
    const md = toMarkdown(thread, [
      msg({ id: 'u', kind: 'user', content: '帮我看看' }),
      msg({ id: 'a', kind: 'agent', content: '好的' }),
    ])
    expect(md).toContain('## 1. 你')
    expect(md).toContain('## 2. Assistant')
    // 正文必须原样保留 —— 导出丢内容是最不该发生的事
    expect(md).toContain('帮我看看')
    expect(md).toContain('好的')
  })

  it('工具消息标出工具名与耗时', () => {
    const md = toMarkdown(thread, [
      msg({
        id: 't',
        kind: 'tool',
        toolName: 'command_execution',
        durationMs: 1500,
        content: '$ ls',
      }),
    ])
    expect(md).toContain('`command_execution`')
    expect(md).toContain('1.5s')
  })

  it('文件变更逐条列出', () => {
    const md = toMarkdown(thread, [
      msg({
        id: 'f',
        kind: 'file_change',
        content: '文件变更',
        fileChanges: [
          { path: 'a.ts', kind: 'add' },
          { path: 'b.ts', kind: 'delete' },
        ],
      }),
    ])
    expect(md).toContain('`a.ts` (add)')
    expect(md).toContain('`b.ts` (delete)')
  })

  it('分叉来的会话标注来源', () => {
    const md = toMarkdown({ ...thread, forkedFromId: '01a0-parent' }, [])
    expect(md).toContain('分叉自')
    expect(md).toContain('01a0-parent')
  })

  it('消息数为 0 也能渲染(不能崩)', () => {
    expect(() => toMarkdown(thread, [])).not.toThrow()
  })
})

describe('toJson', () => {
  it('是可解析的 JSON,且保留结构化字段', () => {
    const parsed = JSON.parse(toJson(thread, [msg({ id: 'a', kind: 'agent', content: 'x' })]))
    expect(parsed.thread.id).toBe('01a0-thread')
    expect(parsed.thread.title).toBe('修一下登录')
    expect(parsed.messages).toHaveLength(1)
    expect(parsed.messages[0].kind).toBe('agent')
  })

  it('工具耗时等字段不会被丢掉(JSON 导出要能二次处理)', () => {
    const parsed = JSON.parse(
      toJson(thread, [msg({ id: 't', kind: 'tool', toolName: 'x', durationMs: 42 })]),
    )
    expect(parsed.messages[0].durationMs).toBe(42)
    expect(parsed.messages[0].toolName).toBe('x')
  })
})

describe('renderExport / exportFileMeta', () => {
  it('按格式分发', () => {
    expect(renderExport('json', thread, []).trimStart()[0]).toBe('{')
    expect(renderExport('markdown', thread, []).trimStart()[0]).toBe('#')
  })

  it('扩展名与 MIME 对得上', () => {
    expect(exportFileMeta('json')).toEqual({ ext: 'json', mime: 'application/json' })
    expect(exportFileMeta('markdown')).toEqual({ ext: 'md', mime: 'text/markdown' })
  })
})
