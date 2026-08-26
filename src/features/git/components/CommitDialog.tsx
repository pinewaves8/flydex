import { Sparkles, X } from 'lucide-react'
import { useState } from 'react'

import { gitService } from '@/services/gitService'

export function CommitDialog({
  repo,
  onCommitted,
  onClose,
}: {
  repo: string
  onCommitted: () => void
  onClose: () => void
}) {
  const [message, setMessage] = useState('')
  const [detail, setDetail] = useState('')
  const [committing, setCommitting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCommit = async () => {
    if (!message.trim()) {
      setError('请输入提交信息')
      return
    }
    setCommitting(true)
    setError(null)
    try {
      const fullMessage = detail.trim() ? `${message.trim()}\n\n${detail.trim()}` : message.trim()
      await gitService.commit(repo, fullMessage)
      onCommitted()
    } catch (e) {
      setError(String(e))
    } finally {
      setCommitting(false)
    }
  }

  // Codex 生成提交信息（MVP：先占位，后续接入 codex 会话）
  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    try {
      // TODO(3.1+): 接入 codex 分析暂存区 diff 生成 conventional commit message
      // 暂时给出占位提示
      setMessage('feat: 更新代码')
      setDetail('由 Flydex Git 面板提交')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[520px] max-w-[90vw] rounded-lg border border-border bg-background shadow-xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium">提交更改</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 主体 */}
        <div className="space-y-3 px-4 py-4">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">提交信息</label>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="feat: 添加新功能"
              autoFocus
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">详细描述（可选）</label>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="补充变更说明…"
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="使用 Codex 生成提交信息"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {generating ? '生成中…' : 'Codex 生成'}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              取消
            </button>
            <button
              onClick={handleCommit}
              disabled={committing || !message.trim()}
              className="rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {committing ? '提交中…' : '提交'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
