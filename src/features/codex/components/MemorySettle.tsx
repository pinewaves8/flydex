import { Brain, Check, Loader2, X } from 'lucide-react'
import { useState } from 'react'

import { memoryService } from '@/services/memoryService'
import { useCodexStore } from '@/stores/useCodexStore'

/** 记忆提炼候选 */
interface MemoryCandidate {
  section: string
  title: string
  content: string
  confidence?: number
}

const SECTION_LABELS: Record<string, string> = {
  活跃约定: '活跃约定',
  决策记录: '决策记录',
  踩坑与规避: '踩坑与规避',
  常用命令: '常用命令',
}

/**
 * 记忆沉淀（6.1 P1）
 *
 * 会话完成后显示「沉淀到项目记忆」入口：
 * 1. 提取：调用当前模型从会话中提炼记忆候选（决策/约定/踩坑/命令）
 * 2. 审批：展示候选列表，用户勾选（写前审批）
 * 3. 写入：写入 <workdir>/.flydex/MEMORY.md（后端审计）
 */
export function MemorySettle({ workdir, onWritten }: { workdir: string; onWritten?: () => void }) {
  const messages = useCodexStore((s) => s.messages)
  const status = useCodexStore((s) => s.status)

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [writing, setWriting] = useState(false)
  const [written, setWritten] = useState(false)

  // 会话文本：拼接当前会话消息（codex 事件流）供模型提炼
  const sessionText = messages
    .map((m) => {
      const role = m.kind === 'agent' ? '助手' : m.kind === 'system' ? '系统' : '事件'
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      return `[${role}] ${content}`
    })
    .join('\n')

  const canSettle = status === 'done' && messages.length > 0 && !!workdir

  const handleExtract = async () => {
    setLoading(true)
    setError('')
    setWritten(false)
    try {
      const res = (await memoryService.extract(sessionText.slice(0, 12000))) as unknown
      const arr = Array.isArray(res)
        ? (res as MemoryCandidate[])
        : (res as { raw?: MemoryCandidate[] })?.raw
      if (Array.isArray(arr)) {
        setCandidates(arr.filter((c) => c && c.title && c.content))
        setSelected(new Set())
      } else {
        setError('提取结果无法解析（模型未返回 JSON 数组），可直接在记忆面板手动编辑')
        setCandidates([])
      }
      setOpen(true)
    } catch (e) {
      setError(String(e))
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(candidates.map((_, i) => i)))
  }

  const handleWrite = async () => {
    if (!workdir) return
    setWriting(true)
    try {
      for (const i of Array.from(selected)) {
        const c = candidates[i]
        const section = SECTION_LABELS[c.section] ? c.section : '决策记录'
        await memoryService.appendProject(
          workdir,
          section,
          `${c.title}\n${c.content}`,
          'session-settle',
        )
      }
      setWritten(true)
      setOpen(false)
      onWritten?.()
    } catch (e) {
      setError(String(e))
    } finally {
      setWriting(false)
    }
  }

  if (!canSettle) return null

  return (
    <div className="mb-2">
      <button
        onClick={handleExtract}
        disabled={loading}
        className="flex items-center gap-1 rounded border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
        title="从本次会话提炼可复用的项目记忆（决策/约定/踩坑/命令），写前需审批"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
        {loading ? '提炼中…' : '沉淀到项目记忆'}
      </button>

      {open && (
        <div className="mt-2 rounded border border-border bg-background/95 p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <Brain className="h-3.5 w-3.5 text-primary" />
              提炼出的记忆候选
            </span>
            <div className="flex items-center gap-2">
              {candidates.length > 0 && (
                <button onClick={selectAll} className="text-[10px] text-primary hover:underline">
                  全选
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {error && <div className="mb-2 text-xs text-red-400">{error}</div>}
          {written && <div className="mb-2 text-xs text-green-500">已写入项目记忆 ✓</div>}

          {candidates.length === 0 && !loading ? (
            <div className="py-2 text-xs text-muted-foreground">
              本次会话没有提炼出可沉淀的高价值记忆。
            </div>
          ) : (
            <div className="max-h-56 space-y-1.5 overflow-auto">
              {candidates.map((c, i) => (
                <label
                  key={i}
                  className="flex cursor-pointer items-start gap-2 rounded border border-border/60 bg-muted/30 px-2 py-1.5 hover:bg-muted/60"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggle(i)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="rounded bg-primary/10 px-1 text-[10px] text-primary">
                        {c.section || '决策记录'}
                      </span>
                      <span className="truncate text-xs font-medium">{c.title}</span>
                      {typeof c.confidence === 'number' && c.confidence < 0.5 && (
                        <span className="text-[10px] text-amber-500">低置信</span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                      {c.content}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {candidates.length > 0 && (
            <div className="mt-2 flex items-center justify-end gap-2">
              <span className="text-[10px] text-muted-foreground">
                已选 {selected.size} / {candidates.length}
              </span>
              <button
                onClick={handleWrite}
                disabled={selected.size === 0 || writing}
                className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {writing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                写入项目记忆
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
