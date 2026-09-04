import {
  FolderOpen,
  Settings,
  Terminal,
  MessageSquare,
  Plus,
  Trash2,
  Pencil,
  GitBranch,
  Search,
  GitFork,
  Download,
  X,
  RotateCcw,
  FolderTree,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useProjectStore } from '@/stores/useProjectStore'
import { useUIStore, type View } from '@/stores/useUIStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'
import type { ExportFormat, SessionMeta, SessionSearchHit } from '@/types/project'

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

/** 下载文本为文件 */
function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 7.4.3 并行时间线：会话 fork 树展示项 */
interface DisplaySession extends SessionMeta {
  /** 树深度（0 = 主线，>0 = 分支层） */
  depth: number
}

/** 7.4.3 按 forkedFrom 构建 fork 树（深度优先平铺），主线在前、分支缩进在后，各自按更新时间倒序 */
function buildForkTree(sessions: SessionMeta[]): DisplaySession[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const children = new Map<string, SessionMeta[]>()
  const roots: SessionMeta[] = []
  for (const s of sessions) {
    if (s.forkedFrom && byId.has(s.forkedFrom.sessionId)) {
      const arr = children.get(s.forkedFrom.sessionId) ?? []
      arr.push(s)
      children.set(s.forkedFrom.sessionId, arr)
    } else {
      roots.push(s)
    }
  }
  const sortFn = (a: SessionMeta, b: SessionMeta) => b.updatedAt - a.updatedAt
  roots.sort(sortFn)
  for (const key of children.keys()) {
    children.get(key)!.sort(sortFn)
  }
  const result: DisplaySession[] = []
  const walk = (node: SessionMeta, depth: number) => {
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
  const {
    sessions,
    trashedSessions,
    searchHits,
    currentSessionId,
    setCurrentSession,
    createSession,
    trashSession,
    renameSession,
    restoreSession,
    loadTrashed,
    forkSession,
    searchSessions,
    clearSearch,
    exportSession,
  } = useProjectStore()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showTrash, setShowTrash] = useState(false)

  // 进入重命名模式时自动聚焦
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const startRename = (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation()
    setRenamingId(id)
    setRenameValue(title)
  }

  const commitRename = async () => {
    if (!renamingId) return
    const newTitle = renameValue.trim()
    const oldTitle = sessions.find((s) => s.id === renamingId)?.title
    if (newTitle && newTitle !== oldTitle) {
      await renameSession(renamingId, newTitle)
    }
    setRenamingId(null)
  }

  const cancelRename = () => {
    setRenamingId(null)
  }

  const handleNewSession = async () => {
    const workdir = useWorkspaceStore.getState().cwd
    await createSession('未命名会话', workdir)
    setCurrentView('codex')
  }

  const handleTrashSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const ok = window.confirm('确定删除该会话？\n（可在底部回收站中恢复）')
    if (!ok) return
    await trashSession(id)
  }

  const handleFork = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    // 默认从最后一条消息 fork（可在后续扩展为让用户选位置）
    const session = await (await import('@/services/sessionService')).sessionService.load(id)
    if (!session) return
    const messageIndex = session.messages.length - 1
    await forkSession(id, Math.max(0, messageIndex))
  }

  const handleExport = async (e: React.MouseEvent, id: string, format: ExportFormat) => {
    e.stopPropagation()
    try {
      const content = await exportSession(id, format)
      const ext = format === 'json' ? 'json' : 'md'
      const mime = format === 'json' ? 'application/json' : 'text/markdown'
      downloadText(content, `session-${id}.${ext}`, mime)
    } catch (err) {
      window.alert(`导出失败: ${String(err)}`)
    }
  }

  // 搜索处理
  const handleSearchChange = (q: string) => {
    setSearchQuery(q)
    if (q.trim()) {
      void searchSessions(q)
    } else {
      clearSearch()
    }
  }

  // 点击搜索结果跳转到会话
  const handleSearchHitClick = (hit: SessionSearchHit) => {
    setCurrentSession(hit.session.id)
    setCurrentView('codex')
    setSearchQuery('')
    clearSearch()
  }

  // 回收站展开时拉取列表
  useEffect(() => {
    if (showTrash) {
      void loadTrashed()
    }
  }, [showTrash, loadTrashed])

  // 渲染单个会话项（7.4.3 支持 fork 树缩进与分支徽标）
  const renderSessionItem = (session: DisplaySession, showMeta = false) => {
    const active = currentSessionId === session.id
    const isRenaming = renamingId === session.id
    const isFork = !!session.forkedFrom
    return (
      <div
        key={session.id}
        onClick={() => {
          if (isRenaming) return
          setCurrentSession(session.id)
          setCurrentView('codex')
        }}
        style={{ paddingLeft: 8 + session.depth * 16 }}
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
                <span
                  title={`分支会话（来自 ${
                    session.forkedFrom?.messageIndex !== undefined
                      ? `第 ${session.forkedFrom.messageIndex + 1} 条消息`
                      : ''
                  }）`}
                >
                  <GitFork className="h-3 w-3 shrink-0 text-primary/70" />
                </span>
              )}
              <div
                className="truncate text-sm"
                title={session.title}
                onDoubleClick={(e) => startRename(e, session.id, session.title)}
              >
                {session.title}
              </div>
            </div>
          )}
          <div
            className={`truncate text-[10px] ${active ? 'opacity-70' : 'text-muted-foreground'}`}
          >
            {relativeTime(session.updatedAt)}
            {showMeta && session.messageCount !== undefined && (
              <> · {session.messageCount} 条消息</>
            )}
          </div>
        </div>
        {!isRenaming && !showMeta && (
          <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={(e) => handleFork(e, session.id)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="Fork 会话（复制到最后一条消息）"
            >
              <GitFork className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => handleExport(e, session.id, 'markdown')}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="导出为 Markdown"
            >
              <Download className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => startRename(e, session.id, session.title)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="重命名"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => handleTrashSession(e, session.id)}
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

  // 搜索结果列表
  const renderSearchResults = () => (
    <div className="space-y-1">
      {searchHits.length === 0 ? (
        <div className="px-2 py-4 text-center text-xs text-muted-foreground">未找到匹配</div>
      ) : (
        searchHits.map((hit) => (
          <div
            key={`${hit.session.id}-${hit.matchField}`}
            onClick={() => handleSearchHitClick(hit)}
            className="group cursor-pointer rounded-md px-2 py-1.5 hover:bg-accent/50"
          >
            <div className="truncate text-sm" title={hit.session.title}>
              {hit.session.title}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {hit.matchField === 'title' ? '🔎 标题匹配' : '💬 内容匹配'} · {hit.snippet}
            </div>
          </div>
        ))
      )}
    </div>
  )

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

      {/* 分隔线 */}
      <div className="mx-2 border-t border-border" />

      {/* 会话列表标题 */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">会话</span>
        <button
          onClick={handleNewSession}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title="新建会话"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 搜索框 */}
      {searchQuery.trim() ? (
        <div className="px-2 pb-2">
          <div className="flex items-center gap-1.5">
            <Search className="h-3 w-3 text-muted-foreground" />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="搜索会话..."
              className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={() => {
                setSearchQuery('')
                clearSearch()
              }}
              className="rounded p-1 text-muted-foreground hover:bg-accent"
              title="关闭搜索"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : null}

      {/* 搜索结果 OR 会话列表 */}
      {searchQuery.trim() ? (
        <div className="flex-1 overflow-y-auto px-2 pb-2">{renderSearchResults()}</div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {sessions.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              暂无会话
              <br />
              点击 + 新建
            </div>
          ) : (
            buildForkTree(sessions).map((session) => renderSessionItem(session))
          )}
        </div>
      )}

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
          {trashedSessions.length > 0 && (
            <span className="rounded bg-destructive/20 px-1.5 py-0.5 text-[10px] text-destructive">
              {trashedSessions.length}
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
          {trashedSessions.length === 0 ? (
            <div className="px-2 py-2 text-center text-xs text-muted-foreground">回收站为空</div>
          ) : (
            <div className="max-h-60 space-y-0.5 overflow-y-auto">
              {trashedSessions.map((session) => (
                <div
                  key={session.id}
                  className="group flex items-center gap-1.5 rounded-md py-1 text-xs hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate" title={session.title}>
                      {session.title}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {session.deletedAt && relativeTime(session.deletedAt)}
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      await restoreSession(session.id)
                    }}
                    className="rounded p-1 text-muted-foreground hover:text-primary"
                    title="恢复"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                  <button
                    onClick={async () => {
                      const ok = window.confirm(
                        `确定永久删除「${session.title}」？\n此操作不可撤销。`,
                      )
                      if (!ok) return
                      await useProjectStore.getState().purgeSession(session.id)
                    }}
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
