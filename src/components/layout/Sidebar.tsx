import {
  Archive,
  Download,
  FolderOpen,
  Settings,
  Terminal,
  MessageSquare,
  Plus,
  Trash2,
  Pencil,
  GitBranch,
  GitFork,
  X,
  RotateCcw,
  FolderTree,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { exportFileMeta } from '@/features/codex/threadExport'
import { useProjectStore } from '@/stores/useProjectStore'
import { useUIStore, type View } from '@/stores/useUIStore'
import { forkDescendantCount, threadTitle } from '@/types/thread'
import type { ThreadRow } from '@/types/thread'

const NAV_ITEMS: { view: View; label: string; icon: typeof MessageSquare }[] = [
  { view: 'codex', label: 'Codex', icon: MessageSquare },
  { view: 'projects', label: 'Projects', icon: FolderOpen },
  { view: 'files', label: 'Files', icon: FolderTree },
  { view: 'terminal', label: 'Terminal', icon: Terminal },
  { view: 'git', label: 'Git', icon: GitBranch },
]

/** 格式化相对时间 */
function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

/** fork 树展示项 */
interface DisplayThread extends ThreadRow {
  /** 树深度（0 = 主线，>0 = 分支层） */
  depth: number
}

/**
 * 按 fork 关系构建树（深度优先平铺）
 *
 * fork 关系来自 codex 的 `forkedFromId`（不再需要 Flydex 自己记录 from/to）。
 * 主线在前、分支缩进在后，各自按更新时间倒序。
 */
function buildForkTree(threads: ThreadRow[]): DisplayThread[] {
  const byId = new Map(threads.map((t) => [t.id, t]))
  const children = new Map<string, ThreadRow[]>()
  const roots: ThreadRow[] = []
  for (const t of threads) {
    // 指向的父线程不在当前列表(跨项目/已归档)时按主线处理,避免出现「孤儿分支」看不见
    if (t.forkedFromId && byId.has(t.forkedFromId)) {
      const arr = children.get(t.forkedFromId) ?? []
      arr.push(t)
      children.set(t.forkedFromId, arr)
    } else {
      roots.push(t)
    }
  }
  const sortFn = (a: ThreadRow, b: ThreadRow) => b.updatedAt - a.updatedAt
  roots.sort(sortFn)
  for (const key of children.keys()) {
    children.get(key)!.sort(sortFn)
  }
  const result: DisplayThread[] = []
  const walk = (node: ThreadRow, depth: number) => {
    result.push({ ...node, depth })
    for (const child of children.get(node.id) ?? []) {
      walk(child, depth + 1)
    }
  }
  for (const root of roots) walk(root, 0)
  return result
}

export function Sidebar() {
  const { currentView, setCurrentView } = useUIStore()
  const threads = useProjectStore((s) => s.threads)
  const archivedThreads = useProjectStore((s) => s.archivedThreads)
  const currentThreadId = useProjectStore((s) => s.currentThreadId)
  const draftActive = useProjectStore((s) => s.draftActive)
  const setCurrentThread = useProjectStore((s) => s.setCurrentThread)
  const newThread = useProjectStore((s) => s.newThread)
  const loadThreads = useProjectStore((s) => s.loadThreads)
  const loadArchivedThreads = useProjectStore((s) => s.loadArchivedThreads)
  const renameThread = useProjectStore((s) => s.renameThread)
  const archiveThread = useProjectStore((s) => s.archiveThread)
  const unarchiveThread = useProjectStore((s) => s.unarchiveThread)
  const deleteThread = useProjectStore((s) => s.deleteThread)
  const exportThread = useProjectStore((s) => s.exportThread)
  const legacySessions = useProjectStore((s) => s.legacySessions)
  const currentSessionId = useProjectStore((s) => s.currentSessionId)
  const setCurrentSession = useProjectStore((s) => s.setCurrentSession)
  const threadWarnings = useProjectStore((s) => s.threadWarnings)
  const dismissThreadWarnings = useProjectStore((s) => s.dismissThreadWarnings)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [showTrash, setShowTrash] = useState(false)

  // 进入重命名模式时自动聚焦
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  // 回收站展开时拉取列表
  useEffect(() => {
    if (showTrash) void loadArchivedThreads()
  }, [showTrash, loadArchivedThreads])

  const startRename = (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation()
    setRenamingId(id)
    setRenameValue(title)
  }

  const commitRename = async () => {
    if (!renamingId) return
    const newTitle = renameValue.trim()
    // 归档列表里也可能在改名(虽然更常见的是主线),两处都查
    const current =
      threads.find((t) => t.id === renamingId) ?? archivedThreads.find((t) => t.id === renamingId)
    if (newTitle && current && newTitle !== threadTitle(current)) {
      await renameThread(renamingId, newTitle)
    }
    setRenamingId(null)
  }

  const cancelRename = () => setRenamingId(null)

  const handleArchive = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const ok = window.confirm('移入回收站？\n（可在底部回收站中恢复）')
    if (!ok) return
    await archiveThread(id)
  }

  const handlePurge = async (e: React.MouseEvent, thread: ThreadRow) => {
    e.stopPropagation()
    // 后端会连同 fork 出的后代一起删(codex 不级联,只删父会留下孤儿),先把量级告诉用户
    const forks = forkDescendantCount([...threads, ...archivedThreads], thread.id)
    const extra =
      forks > 0
        ? `
将一并删除由它分叉出的 ${forks} 个会话。`
        : ''
    const ok = window.confirm(
      `永久删除「${threadTitle(thread)}」？${extra}
此操作不可撤销，且会删除磁盘上的会话记录。`,
    )
    if (!ok) return
    await deleteThread(thread.id)
  }

  /** 导出会话内容为文件(自己拉全量历史后渲染,见 threadExport.ts) */
  const handleExport = async (e: React.MouseEvent, thread: ThreadRow) => {
    e.stopPropagation()
    try {
      const content = await exportThread(thread.id, 'markdown')
      const { ext, mime } = exportFileMeta('markdown')
      const blob = new Blob([content], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `thread-${thread.id.slice(0, 8)}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      // 导出失败必须可见 —— 用户会以为文件已经存下来了
      window.alert(`导出失败: ${String(err)}`)
    }
  }

  /**
   * 渲染「当前会话」的占位项
   *
   * 两种情况都会用到:
   * - 草稿:点了 + 但还没发第一条消息,codex 里尚无 thread
   * - **已认领但列表尚未收录**:codex 的 `thread/list` 会隐藏 preview 为空的线程,
   *   而新线程的 preview(取自首条消息)可能还没落到 state db —— 那段窗口里
   *   当前会话会从列表里"消失",看起来像被删了
   *
   * 判据是「当前会话不在列表里」,所以列表补上之后它会自然被真实项取代。
   */
  const renderPendingItem = (subtitle: string) => (
    <div
      onClick={() => setCurrentView('codex')}
      style={{ paddingLeft: 8 }}
      className="group mb-1 flex cursor-pointer items-center gap-2 rounded-md bg-accent py-1.5 pr-2 text-accent-foreground transition-colors"
    >
      <MessageSquare className="h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">新会话</div>
        <div className="truncate text-[10px] opacity-70">{subtitle}</div>
      </div>
    </div>
  )

  // 渲染单个会话项（支持 fork 树缩进与分支徽标）
  const renderThreadItem = (thread: DisplayThread) => {
    const active = currentThreadId === thread.id
    const isRenaming = renamingId === thread.id
    const isFork = !!thread.forkedFromId
    const title = threadTitle(thread)
    return (
      <div
        key={thread.id}
        onClick={() => {
          if (isRenaming) return
          void setCurrentThread(thread.id)
          setCurrentView('codex')
        }}
        style={{ paddingLeft: 8 + thread.depth * 16 }}
        className={`group mb-1 flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 transition-colors ${
          active
            ? 'bg-accent text-accent-foreground'
            : isFork
              ? 'hover:bg-primary/10'
              : 'hover:bg-accent/50'
        }`}
      >
        <MessageSquare
          className={`h-3.5 w-3.5 shrink-0 ${active ? '' : 'text-muted-foreground'}`}
        />
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') cancelRename()
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded border border-input bg-background px-1 py-0.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-1">
              {isFork && (
                <span title="分支会话（由某个轮次分叉而来）">
                  <GitFork className="h-3 w-3 shrink-0 text-primary/70" />
                </span>
              )}
              <div
                className="truncate text-sm"
                title={title}
                onDoubleClick={(e) => startRename(e, thread.id, title)}
              >
                {title}
              </div>
            </div>
          )}
          <div
            className={`truncate text-[10px] ${active ? 'opacity-70' : 'text-muted-foreground'}`}
          >
            {relativeTime(thread.updatedAt)}
          </div>
        </div>
        {!isRenaming && (
          <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={(e) => startRename(e, thread.id, title)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="重命名"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => handleExport(e, thread)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="导出为 Markdown"
            >
              <Download className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => handleArchive(e, thread.id)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
              title="移到回收站"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="flex w-60 flex-col border-r border-border bg-muted/30">
      {/* 导航 */}
      <nav className="p-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = currentView === item.view
          return (
            <button
              key={item.view}
              onClick={() => setCurrentView(item.view)}
              className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="mx-2 border-t border-border" />

      {/* 会话列表标题 */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">会话</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => void loadThreads()}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="刷新列表"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              newThread()
              setCurrentView('codex')
            }}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="新建会话"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 非致命错误:不能只在 console(第三原则) */}
      {threadWarnings.length > 0 && (
        <div className="mx-2 mb-1 flex items-start gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
          <span className="min-w-0 flex-1 break-all">{threadWarnings.join(';')}</span>
          <button
            onClick={dismissThreadWarnings}
            className="shrink-0 rounded p-0.5 hover:bg-amber-500/20"
            title="关闭"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {draftActive
          ? renderPendingItem('草稿 · 发出第一条消息后保存')
          : currentThreadId && !threads.some((t) => t.id === currentThreadId)
            ? renderPendingItem('正在载入会话信息…')
            : null}
        {threads.length === 0 && !draftActive ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            暂无会话
            <br />
            点击 + 新建
          </div>
        ) : (
          buildForkTree(threads).map((thread) => renderThreadItem(thread))
        )}

        {/* 迁移前的老会话:内容早已不在 codex 里,只能只读看(见 P8) */}
        {legacySessions.length > 0 && (
          <>
            <div
              className="mt-3 mb-1 px-1 text-[10px] font-medium uppercase text-muted-foreground/70"
              title="迁移到 codex 之前的历史会话。它们只落了 AI 侧内容、没有你的提问,无法重建成对话,因此只读保留。"
            >
              旧会话(只读) · {legacySessions.length}
            </div>
            {legacySessions.map((s) => (
              <div
                key={s.id}
                onClick={() => {
                  setCurrentSession(s.id)
                  setCurrentView('codex')
                }}
                className={`group mb-1 flex cursor-pointer items-center gap-2 rounded-md py-1 pr-2 transition-colors ${
                  currentSessionId === s.id
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50'
                }`}
                style={{ paddingLeft: 8 }}
              >
                <Archive className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-muted-foreground" title={s.title}>
                    {s.title}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground/70">
                    {relativeTime(s.updatedAt)}
                    {s.messageCount !== undefined && <> · {s.messageCount} 条消息</>}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* 底部 Settings + 回收站 */}
      <div className="border-t border-border p-2">
        <button
          onClick={() => setShowTrash(!showTrash)}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
            showTrash
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
        >
          <Trash2 className="h-4 w-4" />
          <span className="flex-1 text-left">回收站</span>
          {archivedThreads.length > 0 && (
            <span className="rounded bg-destructive/20 px-1.5 py-0.5 text-[10px] text-destructive">
              {archivedThreads.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setCurrentView('settings')}
          className={`mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
            currentView === 'settings'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
      </div>

      {/* 回收站面板 */}
      {showTrash && (
        <div className="border-t border-border bg-background/50 p-2">
          <div className="mb-1 px-2 text-[10px] font-medium uppercase text-muted-foreground">
            已删除的会话
          </div>
          {archivedThreads.length === 0 ? (
            <div className="px-2 py-2 text-center text-xs text-muted-foreground">回收站为空</div>
          ) : (
            <div className="max-h-60 space-y-0.5 overflow-y-auto">
              {archivedThreads.map((thread) => (
                <div
                  key={thread.id}
                  className="group flex items-center gap-1.5 rounded-md py-1 text-xs hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate" title={threadTitle(thread)}>
                      {threadTitle(thread)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {relativeTime(thread.updatedAt)}
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      await unarchiveThread(thread.id)
                    }}
                    className="rounded p-1 text-muted-foreground hover:text-primary"
                    title="恢复"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => handlePurge(e, thread)}
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                    title="永久删除"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
