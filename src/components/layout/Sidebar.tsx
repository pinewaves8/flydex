import {
  FolderOpen,
  Settings,
  Terminal,
  MessageSquare,
  Plus,
  Trash2,
  Pencil,
  GitBranch,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useProjectStore } from '@/stores/useProjectStore'
import { useUIStore, type View } from '@/stores/useUIStore'

const NAV_ITEMS: { view: View; label: string; icon: typeof MessageSquare }[] = [
  { view: 'codex', label: 'Codex', icon: MessageSquare },
  { view: 'projects', label: 'Projects', icon: FolderOpen },
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

export function Sidebar() {
  const { currentView, setCurrentView } = useUIStore()
  const {
    sessions,
    currentSessionId,
    setCurrentSession,
    createSession,
    deleteSession,
    renameSession,
  } = useProjectStore()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

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
    const workdir = 'C:\\llm\\flydex'
    await createSession('未命名会话', workdir)
    setCurrentView('codex')
  }

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await deleteSession(id)
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

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            暂无会话
            <br />
            点击 + 新建
          </div>
        ) : (
          sessions.map((session) => {
            const active = currentSessionId === session.id
            const isRenaming = renamingId === session.id
            return (
              <div
                key={session.id}
                onClick={() => {
                  if (isRenaming) return
                  setCurrentSession(session.id)
                  setCurrentView('codex')
                }}
                className={`group mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                  active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
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
                    <div
                      className="truncate text-sm"
                      title={session.title}
                      onDoubleClick={(e) => startRename(e, session.id, session.title)}
                    >
                      {session.title}
                    </div>
                  )}
                  <div
                    className={`truncate text-[10px] ${active ? 'opacity-70' : 'text-muted-foreground'}`}
                  >
                    {relativeTime(session.updatedAt)}
                  </div>
                </div>
                {!isRenaming && (
                  <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => startRename(e, session.id, session.title)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      title="重命名"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => handleDeleteSession(e, session.id)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                      title="删除会话"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 底部 Settings */}
      <div className="border-t border-border p-2">
        <button
          onClick={() => setCurrentView('settings')}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
            currentView === 'settings'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
      </div>
    </aside>
  )
}
