import { describe, expect, it } from 'vitest'

import {
  COMPACTION_SUMMARY_PREFIX,
  formatToolContent,
  hasInjectedContext,
  isCompactedTurns,
  isCompactionSummary,
  mapItemToMessage,
  summarizeToolResult,
  turnsToMessages,
} from '@/features/codex/threadItems'
import type { ThreadItem, ThreadTurn } from '@/types/thread'

/**
 * 这些用例盯的是**契约**,不是实现细节:
 *
 * - `mapItemToMessage` 是实时事件与历史重载**共用的唯一映射**,形状错了会导致
 *   「重载后和实时看到的不一样」—— 这类漂移很难在界面上发现。
 * - `formatToolContent` 的产物会被 MessageCard 解析首行(剥 `$ ` 前缀显示命令),
 *   格式一变首行解析就错。
 *
 * 输入是 **exec 风格(snake_case)** —— app-server 的 camelCase 已在 Rust 侧
 * `map_item` 转过(见 src-tauri/src/services/appserver_client.rs)。
 */

const TS = 1_700_000_000_000

function item(v: Record<string, unknown>): ThreadItem {
  return v as unknown as ThreadItem
}

describe('mapItemToMessage · 用户消息', () => {
  it('拼接 content 里的文本段', () => {
    const m = mapItemToMessage(
      item({
        id: 'item-1',
        type: 'user_message',
        content: [
          { type: 'text', text: '前半' },
          { type: 'text', text: '后半' },
        ],
      }),
      TS,
      'turn-1',
    )
    expect(m).toMatchObject({ kind: 'user', content: '前半后半', turnId: 'turn-1' })
  })

  it('非文本段计为附件并在正文里标注', () => {
    const m = mapItemToMessage(
      item({
        id: 'item-2',
        type: 'user_message',
        content: [
          { type: 'text', text: '看这个' },
          { type: 'image', url: 'x' },
        ],
      }),
      TS,
    )
    expect(m?.content).toContain('看这个')
    expect(m?.content).toContain('[1 个附件]')
  })

  it('既无文本也无附件时不产出消息', () => {
    expect(mapItemToMessage(item({ id: 'i', type: 'user_message', content: [] }), TS)).toBeNull()
  })
})

describe('mapItemToMessage · reasoning', () => {
  it('summary 与 content 都是 string[],优先取 summary', () => {
    // 回归:旧实现按 `{text}[]` 取值,在真实数据上恒为空 —— 思考卡片从未显示过
    const m = mapItemToMessage(
      item({
        id: 'r1',
        type: 'reasoning',
        summary: ['摘要一', '摘要二'],
        content: ['很长很长的原始思维链'],
      }),
      TS,
    )
    expect(m?.kind).toBe('reasoning')
    expect(m?.content).toBe('摘要一摘要二')
  })

  it('summary 为空时回退到 content', () => {
    const m = mapItemToMessage(
      item({ id: 'r2', type: 'reasoning', summary: [], content: ['原文'] }),
      TS,
    )
    expect(m?.content).toBe('原文')
  })

  it('summary 只有空白也算空,应回退 content', () => {
    const m = mapItemToMessage(
      item({ id: 'r3', type: 'reasoning', summary: ['   '], content: ['原文'] }),
      TS,
    )
    expect(m?.content).toBe('原文')
  })

  it('两者都空则不出消息(避免一张空卡片)', () => {
    expect(mapItemToMessage(item({ id: 'r4', type: 'reasoning' }), TS)).toBeNull()
  })
})

describe('formatToolContent · MessageCard 依赖的首行格式', () => {
  it('有耗时与输出', () => {
    expect(formatToolContent('ls -la', 1234, 'a\nb')).toBe('$ ls -la · 1.2s\na\nb')
  })

  it('无耗时不带时间徽章', () => {
    expect(formatToolContent('pwd', undefined, '')).toBe('$ pwd')
  })

  it('首行始终是命令 —— MessageCard 就是靠剥掉 `$ ` 来显示命令的', () => {
    const content = formatToolContent('echo hi', 500, '多行\n输出')
    expect(content.split('\n')[0]).toBe('$ echo hi · 0.5s')
  })
})

describe('mapItemToMessage · 工具类 item', () => {
  it('command_execution 带上耗时与结果摘要', () => {
    const m = mapItemToMessage(
      item({
        id: 'c1',
        type: 'command_execution',
        command: 'ls',
        status: 'completed',
        aggregated_output: '第一行\n第二行',
        exit_code: 0,
        duration_ms: 2500,
      }),
      TS,
    )
    expect(m).toMatchObject({ kind: 'tool', toolName: 'command_execution', durationMs: 2500 })
    expect(m?.content).toContain('$ ls · 2.5s')
    expect(m?.toolResult).toBe('第一行')
  })

  it('命令失败时把退出码写进卡片', () => {
    const m = mapItemToMessage(
      item({ id: 'c2', type: 'command_execution', command: 'bad', status: 'failed', exit_code: 2 }),
      TS,
    )
    expect(m?.content).toContain('失败')
    expect(m?.content).toContain('2')
  })

  it('command_execution 没有 id 时也要有稳定的兜底 id', () => {
    // 协议里该变体的 id 是可选的
    const m = mapItemToMessage(
      item({ type: 'command_execution', command: 'ls', status: 'completed' }),
      TS,
    )
    expect(m?.id).toBe(`command_execution-${TS}`)
  })

  it('空命令不产出消息', () => {
    expect(
      mapItemToMessage(item({ id: 'c3', type: 'command_execution', command: '  ' }), TS),
    ).toBeNull()
  })

  it('mcp_tool_call 用 server·tool 作为工具名', () => {
    const m = mapItemToMessage(
      item({
        id: 'm1',
        type: 'mcp_tool_call',
        server: 'fs',
        tool: 'read',
        status: 'completed',
        result: '内容',
        duration_ms: 800,
      }),
      TS,
    )
    expect(m?.toolName).toBe('fs · read')
    expect(m?.content).toContain('（完成）')
    expect(m?.toolResult).toBe('内容')
  })

  it('mcp_tool_call 失败时带错误信息且不展示结果', () => {
    const m = mapItemToMessage(
      item({
        id: 'm2',
        type: 'mcp_tool_call',
        server: 'fs',
        tool: 'read',
        status: 'failed',
        error: { message: '拒绝访问' },
        result: '不该出现',
      }),
      TS,
    )
    expect(m?.content).toContain('失败')
    expect(m?.content).toContain('拒绝访问')
    expect(m?.toolResult).toBeUndefined()
  })
})

describe('mapItemToMessage · 文件变更', () => {
  it('把协议里的 kind 对象拍平成字符串', () => {
    // 协议是 {"type":"update","movePath":...},前端类型是 'update'
    const m = mapItemToMessage(
      item({
        id: 'f1',
        type: 'file_change',
        changes: [
          { path: 'a.ts', kind: { type: 'add' } },
          { path: 'b.ts', kind: { type: 'update', move_path: null } },
        ],
      }),
      TS,
    )
    expect(m?.kind).toBe('file_change')
    expect(m?.fileChanges).toEqual([
      { path: 'a.ts', kind: 'add' },
      { path: 'b.ts', kind: 'update' },
    ])
  })

  it('未知的 kind 退化为 update,而不是丢弃这张卡片', () => {
    const m = mapItemToMessage(
      item({ id: 'f2', type: 'file_change', changes: [{ path: 'x', kind: '怪值' }] }),
      TS,
    )
    expect(m?.fileChanges?.[0].kind).toBe('update')
  })

  it('没有变更项时不产出消息', () => {
    expect(mapItemToMessage(item({ id: 'f3', type: 'file_change', changes: [] }), TS)).toBeNull()
  })
})

describe('mapItemToMessage · 其余变体', () => {
  it('codex 的 plan item 按普通文本渲染,不映射成 Flydex 的 plan 卡片', () => {
    // Flydex 的 plan 卡片是"计划模式"下的转换产物,语义不同
    const m = mapItemToMessage(item({ id: 'p1', type: 'plan', text: '先做 A 再做 B' }), TS)
    expect(m?.kind).toBe('agent')
    expect(m?.content).toBe('先做 A 再做 B')
  })

  it('审查模式进出、上下文压缩等归为 system', () => {
    for (const t of ['entered_review_mode', 'exited_review_mode', 'context_compaction']) {
      expect(mapItemToMessage(item({ id: 's-' + t, type: t }), TS)?.kind).toBe('system')
    }
  })

  it('子代理类归为 subagent', () => {
    expect(
      mapItemToMessage(item({ id: 'a1', type: 'sub_agent_activity', kind: 'started' }), TS)?.kind,
    ).toBe('subagent')
    expect(
      mapItemToMessage(item({ id: 'a2', type: 'collab_agent_tool_call', tool: 'spawn' }), TS)?.kind,
    ).toBe('subagent')
  })

  it('sleep 不展示', () => {
    expect(mapItemToMessage(item({ id: 'z', type: 'sleep', duration_ms: 100 }), TS)).toBeNull()
  })

  it('未知变体安全忽略,不抛错', () => {
    // codex 的 item 仍在演进,遇到不认识的要能兜住
    expect(mapItemToMessage(item({ id: 'u', type: '未来才有的类型' }), TS)).toBeNull()
  })
})

describe('summarizeToolResult', () => {
  it('取首个非空行', () => {
    expect(summarizeToolResult('\n\n  第一行  \n第二行')).toBe('第一行')
  })

  it('对象会被序列化', () => {
    expect(summarizeToolResult({ a: 1 })).toBe('{"a":1}')
  })

  it('超过 200 字截断并加省略号', () => {
    const s = summarizeToolResult('x'.repeat(500))
    expect(s).toHaveLength(201)
    expect(s.endsWith('…')).toBe(true)
  })

  it('null / undefined 返回空串', () => {
    expect(summarizeToolResult(null)).toBe('')
    expect(summarizeToolResult(undefined)).toBe('')
  })
})

describe('hasInjectedContext', () => {
  it('识别早期 Flydex 注入的项目规范前缀', () => {
    expect(hasInjectedContext('# 项目规范(自动加载自项目根)\n\n# AGENTS.md\n...')).toBe(true)
  })

  it('正常提问不受影响', () => {
    expect(hasInjectedContext('帮我看看这个 bug')).toBe(false)
  })

  it('标记出现在中间不算(必须是前缀)', () => {
    expect(hasInjectedContext('你好\n\n# 项目规范(自动加载自项目根)')).toBe(false)
  })
})

describe('turnsToMessages', () => {
  const turn = (id: string, items: ThreadItem[], extra: Partial<ThreadTurn> = {}): ThreadTurn => ({
    id,
    status: 'completed',
    startedAt: TS,
    completedAt: TS + 1000,
    durationMs: 1000,
    error: null,
    items,
    ...extra,
  })

  it('按轮顺序展开,并给每条消息打上 turnId', () => {
    const { messages, turns } = turnsToMessages([
      turn('t1', [
        item({ id: 't1-u', type: 'user_message', content: [{ type: 'text', text: '一' }] }),
        item({ id: 't1-a', type: 'agent_message', text: '回应一' }),
      ]),
      turn('t2', [
        item({ id: 't2-u', type: 'user_message', content: [{ type: 'text', text: '二' }] }),
      ]),
    ])
    expect(messages.map((m) => m.id)).toEqual(['t1-u', 't1-a', 't2-u'])
    expect(messages.map((m) => m.turnId)).toEqual(['t1', 't1', 't2'])
    expect(turns.map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('失败的轮补一条错误消息 —— 否则界面上会静默结束', () => {
    const { messages } = turnsToMessages([
      turn('t1', [item({ id: 'a', type: 'agent_message', text: '半句话' })], {
        status: 'failed',
        error: { message: 'high demand' },
      }),
    ])
    const err = messages.find((m) => m.kind === 'error')
    expect(err?.content).toBe('high demand')
    expect(err?.turnId).toBe('t1')
  })

  it('item 没有时间戳时用所属轮的时间兜底', () => {
    const { messages } = turnsToMessages([
      turn('t1', [item({ id: 'a', type: 'agent_message', text: 'x' })], { completedAt: 42 }),
    ])
    expect(messages[0].timestamp).toBe(42)
  })

  it('空轮不会产出消息,但元信息仍保留', () => {
    const { messages, turns } = turnsToMessages([turn('t1', [])])
    expect(messages).toHaveLength(0)
    expect(turns).toHaveLength(1)
  })
})

describe('压缩摘要的识别', () => {
  // 回归:codex 压缩后会把**整个历史重写成一条** userMessage,文本以固定前缀开头。
  // 不识别它,这条英文摘要就会以"用户提问"的身份糊满一屏。
  const summary = `${COMPACTION_SUMMARY_PREFIX}
摘要正文……`

  it('识别压缩摘要', () => {
    expect(isCompactionSummary(summary)).toBe(true)
  })

  it('普通提问不算', () => {
    expect(isCompactionSummary('帮我改一下这个文件')).toBe(false)
  })

  it('前缀出现在中间不算(必须是开头)', () => {
    expect(
      isCompactionSummary(`你好
${COMPACTION_SUMMARY_PREFIX}`),
    ).toBe(false)
  })

  it('isCompactedTurns 认「首条 item 是摘要 userMessage」的历史', () => {
    const turn = (items: ThreadItem[]): ThreadTurn => ({
      id: 't1',
      status: 'completed',
      startedAt: 0,
      completedAt: 0,
      durationMs: 0,
      error: null,
      items,
    })
    const summaryTurn = turn([
      item({ id: 'u1', type: 'user_message', content: [{ type: 'text', text: summary }] }),
    ])
    expect(isCompactedTurns([summaryTurn])).toBe(true)

    const normalTurn = turn([
      item({ id: 'u2', type: 'user_message', content: [{ type: 'text', text: '你好' }] }),
    ])
    expect(isCompactedTurns([normalTurn])).toBe(false)
    // 空历史不能误判成"已压缩"(否则压缩轮询会立刻以为完成)
    expect(isCompactedTurns([])).toBe(false)
  })

  it('压缩摘要经映射后仍是一条 user 消息(由卡片决定怎么展示)', () => {
    const m = mapItemToMessage(
      item({ id: 'u1', type: 'user_message', content: [{ type: 'text', text: summary }] }),
      TS,
    )
    expect(m?.kind).toBe('user')
    expect(isCompactionSummary(m!.content)).toBe(true)
  })
})
