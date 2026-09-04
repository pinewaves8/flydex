import { Play, Plus, Trash2, Workflow, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  addHook,
  clearHooks,
  listHooks,
  listHooksEvents,
  removeHook,
  testHook,
} from '@/services/hooksService'
import type { HookRunResult, HooksConfig } from '@/types/hooks'

export function HooksSettings() {
  const [events, setEvents] = useState<string[]>([])
  const [config, setConfig] = useState<HooksConfig | null>(null)
  const [event, setEvent] = useState('TurnCompleted')
  const [command, setCommand] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState<HookRunResult | null>(null)
  const [testing, setTesting] = useState(false)

  const load = async () => {
    const [evs, cfg] = await Promise.all([listHooksEvents(), listHooks()])
    setEvents(evs)
    setConfig(cfg)
  }

  useEffect(() => {
    void load()
  }, [])

  const handleAdd = async () => {
    if (!command.trim()) return
    setError('')
    setTestResult(null)
    try {
      const cfg = await addHook(event, command.trim(), note.trim())
      setConfig(cfg)
      setCommand('')
      setNote('')
    } catch (e) {
      setError(String(e))
    }
  }

  const handleRemove = async (index: number) => {
    const cfg = await removeHook(index)
    setConfig(cfg)
  }

  const handleClear = async () => {
    if (!config?.hooks.length) return
    const ok = window.confirm('确定清空全部 Hooks 吗？')
    if (!ok) return
    const cfg = await clearHooks()
    setConfig(cfg)
    setTestResult(null)
  }

  const handleTest = async () => {
    if (!command.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await testHook(event, command.trim())
      setTestResult(r)
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      {/* 说明 */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Workflow className="h-4 w-4" />
          Hooks（生命周期自动化）
          <span className="text-xs opacity-60">（对齐 Claude Code：事件触发执行 shell 命令）</span>
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          在 Codex 对话的关键生命周期事件触发时，自动执行你配置的 PowerShell
          命令。典型用途：任务完成通知、错误上报、
          文件变更后自动格式化、每轮结束的额外收尾。命中内置/自定义 deny
          规则的危险命令不会执行（安全底线）。 所有执行记录在{' '}
          <code>~/.flydex/hooks-audit.jsonl</code>。
        </p>
      </section>

      {/* 新增 hook 表单 */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">新增 Hook</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            className="h-9 rounded-md border border-border bg-card px-2 font-mono text-xs outline-none focus:border-primary"
          >
            {events.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAdd()
            }}
            placeholder="PowerShell 命令，如 echo done >> hook.log"
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-3 font-mono text-xs outline-none focus:border-primary"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注（可选）"
            className="h-9 w-36 rounded-md border border-border bg-card px-3 text-xs outline-none focus:border-primary"
          />
          <button
            onClick={() => void handleAdd()}
            disabled={!command.trim()}
            className="flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            添加
          </button>
          <button
            onClick={() => void handleTest()}
            disabled={!command.trim() || testing}
            className="flex h-9 items-center gap-1 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" />
            {testing ? '测试中…' : '测试'}
          </button>
        </div>
        {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
        {testResult && (
          <div className="mb-3 rounded-lg border border-border bg-card p-3">
            <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="font-semibold">测试结果</span>
              {testResult.skipped ? (
                <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-semibold text-red-600">
                  已拦截：{testResult.reason}
                </span>
              ) : testResult.exit === 0 ? (
                <span className="rounded bg-green-500/10 px-1.5 py-0.5 font-semibold text-green-600">
                  exit 0 · {testResult.ms}ms
                </span>
              ) : (
                <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-600">
                  exit {String(testResult.exit)} · {testResult.ms}ms
                </span>
              )}
            </div>
            {testResult.stdout && (
              <pre className="mb-1 overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[11px] text-foreground">
                {testResult.stdout}
              </pre>
            )}
            {testResult.stderr && (
              <pre className="overflow-x-auto rounded bg-red-500/5 p-2 font-mono text-[11px] text-red-600">
                {testResult.stderr}
              </pre>
            )}
          </div>
        )}
      </section>

      {/* hooks 列表 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            已配置 Hooks
            <span className="ml-2 text-xs opacity-60">（{config?.hooks.length ?? 0} 条）</span>
          </h2>
          {(config?.hooks.length ?? 0) > 0 && (
            <button
              onClick={() => void handleClear()}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              <Trash2 className="h-3 w-3" />
              清空
            </button>
          )}
        </div>
        {!config || config.hooks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            暂无 Hook。选择事件并填写命令，在 Codex 对话生命周期自动执行。
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {config.hooks.map((h, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                  {h.event}
                </span>
                <span className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
                  {h.command}
                </span>
                {h.note && (
                  <span className="max-w-[160px] shrink-0 truncate text-[10px] text-muted-foreground">
                    {h.note}
                  </span>
                )}
                <button
                  onClick={() => {
                    setEvent(h.event)
                    setCommand(h.command)
                    setNote(h.note)
                  }}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="回填到表单"
                >
                  <Play className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => void handleRemove(i)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="删除 hook"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
