import { BookOpen, Database, Loader2, Save, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { memoryService, type MemoryData } from '@/services/memoryService'

/**
 * 记忆管理面板（6.1 P1）
 *
 * 查看 / 编辑 项目记忆（.flydex/MEMORY.md）与用户记忆（~/.flydex/MEMORY.md）。
 * 编辑内容直接覆盖写回（后端审计记录），用于手动维护与修正自动沉淀的记忆。
 */
export function MemoryPanel({
  workdir,
  open,
  onClose,
}: {
  workdir: string
  open: boolean
  onClose: () => void
}) {
  const [tab, setTab] = useState<'project' | 'user'>('project')
  const [data, setData] = useState<MemoryData | null>(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    setSaved(false)
    memoryService
      .load(workdir || null)
      .then((d) => {
        setData(d)
        setText(d.project || '')
        setTab(d.project || workdir ? 'project' : 'user')
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [open, workdir])

  useEffect(() => {
    if (!open) return
    if (!data) return
    setText(tab === 'project' ? data.project : data.user)
  }, [tab, open, data])

  if (!open) return null

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      if (tab === 'project') {
        if (!workdir) return
        await memoryService.writeProject(workdir, text)
        setData((d) => (d ? { ...d, project: text } : d))
      } else {
        await memoryService.writeUser(text)
        setData((d) => (d ? { ...d, user: text } : d))
      }
      setSaved(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <BookOpen className="h-4 w-4 text-primary" />
            记忆管理
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab */}
        <div className="flex items-center gap-1 border-b border-border px-4 py-2">
          <button
            onClick={() => setTab('project')}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs ${
              tab === 'project'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <BookOpen className="h-3 w-3" />
            项目记忆 (L2)
          </button>
          <button
            onClick={() => setTab('user')}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs ${
              tab === 'user' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Database className="h-3 w-3" />
            用户记忆 (L1)
          </button>
        </div>

        {/* 文件路径 */}
        <div className="px-4 pt-2 text-[10px] text-muted-foreground">
          {tab === 'project'
            ? data?.project_file || '（未设置工作目录）'
            : data?.user_file || '~/.flydex/MEMORY.md'}
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-auto px-4 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              placeholder={
                tab === 'project'
                  ? '## 活跃约定\n\n## 决策记录\n\n## 踩坑与规避\n\n## 常用命令'
                  : '在此维护跨项目的用户级记忆（偏好、全局约定）'
              }
              className="h-64 w-full resize-none rounded border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground outline-none focus:border-primary/50"
            />
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <div className="text-xs">
            {saved && <span className="text-green-500">已保存 ✓</span>}
            {error && <span className="text-red-400">{error}</span>}
            {!saved && !error && (
              <span className="text-muted-foreground">
                {tab === 'project'
                  ? '自动沉淀的记忆写在这里，每次对话注入'
                  : '跨项目生效的用户级记忆'}
              </span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
