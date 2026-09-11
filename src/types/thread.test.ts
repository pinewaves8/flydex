import { describe, expect, it } from 'vitest'

import {
  forkDescendantCount,
  isInsidePath,
  normPath,
  threadTitle,
  type ThreadRow,
} from '@/types/thread'

/**
 * 路径归一这几个函数踩过坑,所以用例写得比较细:
 *
 * codex 记录的 cwd 带 Windows verbatim 前缀(`\\?\C:\...`),而项目的 path 是人写的
 * (`C:\...`)。不归一就永远匹配不上 —— 表现为「明明在同一个目录,却认成两个地方」,
 * 而且是**静默**的(列表只是少了几条,不报错)。
 *
 * 注意:下面的路径一律由 `bs()` 拼出来,不写反斜杠字面量 —— 这类字面量在
 * 编辑/传输的各层转义里极易被吃掉一半,写出来的用例会「自洽但测的是别的东西」。
 */
const BS = String.fromCharCode(92)

/** 拼一个含反斜杠的路径:bs('C:', 'llm', 'flydex') → C:\llm\flydex */
function bs(...parts: string[]): string {
  return parts.join(BS)
}

/** 拼一个 verbatim 前缀路径:`\\?\C:\llm\flydex` */
function verbatim(...parts: string[]): string {
  return BS + BS + '?' + BS + bs(...parts)
}

function row(v: Partial<ThreadRow> & { id: string }): ThreadRow {
  return {
    name: null,
    preview: '',
    forkedFromId: null,
    parentThreadId: null,
    projectId: null,
    createdAt: 0,
    updatedAt: 0,
    cwd: '',
    historyMode: 'legacy',
    modelProvider: '',
    status: 'idle',
    archived: false,
    ...v,
  }
}

describe('normPath', () => {
  it('剥掉 Windows verbatim 前缀(实测主线)', () => {
    expect(normPath(verbatim('C:', 'llm', 'flydex'))).toBe('c:/llm/flydex')
  })

  it('不带前缀的形式要幂等', () => {
    expect(normPath(bs('C:', 'llm', 'flydex'))).toBe('c:/llm/flydex')
    expect(normPath(normPath(bs('C:', 'llm', 'flydex')))).toBe('c:/llm/flydex')
  })

  it('verbatim 的 UNC 形式还原成普通 UNC,而不是把整个前缀一起削掉', () => {
    // BS*2 + '?' + BS + 'UNC' + BS 才是 verbatim 前缀,少了这一层判断
    // \\?\UNC\server\share 会被削成 UNC\server\share
    expect(normPath(bs('', '', '?', 'UNC', 'server', 'share'))).toBe('//server/share')
  })

  it('单反斜杠的 \\?\\ 是另一种东西,不该被误删', () => {
    expect(normPath(bs('', '?', 'C:', 'x'))).toBe('/?/c:/x')
  })

  it('统一大小写、分隔符与尾斜杠', () => {
    expect(normPath('  C:/LLM/Flydex/  ')).toBe('c:/llm/flydex')
    expect(normPath(bs('C:', 'LLM', 'flydex') + BS)).toBe('c:/llm/flydex')
  })

  it('空串安全', () => {
    expect(normPath('')).toBe('')
    expect(normPath('   ')).toBe('')
  })
})

describe('isInsidePath', () => {
  const project = bs('C:', 'llm', 'flydex')

  it('同一目录算命中', () => {
    expect(isInsidePath(verbatim('C:', 'llm', 'flydex'), project)).toBe(true)
  })

  it('子目录算命中(项目是一个目录树,src-tauri 下的对话也属于它)', () => {
    expect(isInsidePath(bs('C:', 'llm', 'flydex', 'src-tauri'), project)).toBe(true)
  })

  it('同前缀的兄弟目录**不算** —— 必须有分隔符边界', () => {
    // 少了边界判断,C:\llm\flydex-other 会被误判成 C:\llm\flydex 的子树
    expect(isInsidePath(bs('C:', 'llm', 'flydex-other'), project)).toBe(false)
  })

  it('父目录不算子目录', () => {
    expect(isInsidePath(bs('C:', 'llm'), project)).toBe(false)
  })

  it('任一侧为空都返回 false(避免空串匹配一切)', () => {
    expect(isInsidePath('', project)).toBe(false)
    expect(isInsidePath(project, '')).toBe(false)
  })
})

describe('threadTitle', () => {
  it('有显式标题时优先用它', () => {
    expect(threadTitle(row({ id: 't', name: '我的标题', preview: '首条消息' }))).toBe('我的标题')
  })

  it('标题是空白时回退到首条消息', () => {
    expect(threadTitle(row({ id: 't', name: '   ', preview: '首条消息' }))).toBe('首条消息')
  })

  it('首条消息里的换行会被压平', () => {
    expect(threadTitle(row({ id: 't', preview: '第一行\n第二行' }))).toBe('第一行 第二行')
  })

  it('过长时截断到 40 字加省略号', () => {
    const t = threadTitle(row({ id: 't', preview: 'x'.repeat(100) }))
    expect(t).toHaveLength(41)
    expect(t.endsWith('…')).toBe(true)
  })

  it('两者都空时给占位文案', () => {
    expect(threadTitle(row({ id: 't' }))).toBe('未命名会话')
  })
})

describe('forkDescendantCount', () => {
  it('没有分支时为 0', () => {
    expect(forkDescendantCount([row({ id: 'a' })], 'a')).toBe(0)
  })

  it('链式分支全部计入', () => {
    const all = [
      row({ id: 'a' }),
      row({ id: 'b', forkedFromId: 'a' }),
      row({ id: 'c', forkedFromId: 'b' }),
    ]
    expect(forkDescendantCount(all, 'a')).toBe(2)
  })

  it('多个分支共享同一后代时不重复计数(菱形)', () => {
    const all = [
      row({ id: 'a' }),
      row({ id: 'b', forkedFromId: 'a' }),
      row({ id: 'c', forkedFromId: 'a' }),
      row({ id: 'd', forkedFromId: 'b' }),
      row({ id: 'e', forkedFromId: 'c' }),
    ]
    expect(forkDescendantCount(all, 'a')).toBe(4)
  })

  it('别人家树上的分支不计入', () => {
    const all = [row({ id: 'a' }), row({ id: 'x' }), row({ id: 'y', forkedFromId: 'x' })]
    expect(forkDescendantCount(all, 'a')).toBe(0)
  })

  it('数据异常成环时不死循环', () => {
    // 这条用例要的是**终止性**:a 与 b 互相可达,靠 seen 集合去重才不会无限递归。
    // 计数本身没有"正确值"可言(成环的数据本就不该出现),所以只要求它跑得出来。
    const all = [row({ id: 'a', forkedFromId: 'b' }), row({ id: 'b', forkedFromId: 'a' })]
    expect(forkDescendantCount(all, 'a')).toBe(2)
  })
})
