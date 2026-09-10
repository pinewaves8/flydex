import { open } from '@tauri-apps/plugin-dialog'
import { Folder, FolderOpen, Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useProjectStore } from '@/stores/useProjectStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'
import type { Project } from '@/types/project'

/** 相对时间 */
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

/** 从路径取项目名（最后一段目录名） */
function nameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function ProjectsPanel() {
  const {
    projects,
    currentProjectId,
    loadProjects,
    createProject,
    renameProject,
    deleteProject,
    setCurrentProject,
    loading,
  } = useProjectStore()

  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const setWorkspaceCwd = useWorkspaceStore((s) => s.setCwd)

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  // 通过文件夹对话框新建项目
  const handleCreate = async () => {
    setError(null)
    const dir = await open({
      directory: true,
      multiple: false,
      title: '选择项目文件夹',
    })
    if (typeof dir !== 'string' || !dir) return
    setCreating(true)
    try {
      const name = nameFromPath(dir)
      const created = await createProject(name, dir)
      // 新建项目后立即设为当前项目，并同步全局工作目录（遵循 codex：cwd 唯一事实源）
      await setCurrentProject(created.id)
      setWorkspaceCwd(dir)
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (e: React.MouseEvent, project: Project) => {
    e.stopPropagation()
    setError(null)
    // 删项目会**连带删掉该项目下的全部会话**(不可撤销),必须先确认
    const ok = window.confirm(
      `删除项目「${project.name}」？

将一并永久删除该项目下的全部会话，此操作不可撤销。`,
    )
    if (!ok) return
    try {
      await deleteProject(project.id)
    } catch (err) {
      // 失败必须可见 —— 后端在有会话删不掉时会保留项目与本地条目
      setError(String(err))
    }
  }

  const startRename = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation()
    setRenamingId(project.id)
    setRenameValue(project.name)
  }

  const commitRename = async () => {
    if (!renamingId) return
    const name = renameValue.trim()
    const project = projects.find((p) => p.id === renamingId)
    if (name && project && name !== project.name) {
      try {
        await renameProject(project.id, name)
      } catch (e) {
        setError(String(e))
      }
    }
    setRenamingId(null)
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
        <h2 className="text-sm font-medium">项目</h2>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          新建项目
        </button>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* 项目列表 */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading && projects.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>
        )}

        {!loading && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <FolderOpen className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">还没有项目</p>
            <p className="text-xs text-muted-foreground/70">点击右上角"新建项目"选择文件夹</p>
          </div>
        )}

        <div className="space-y-2">
          {projects.map((project) => {
            const active = project.id === currentProjectId
            const isRenaming = renamingId === project.id
            return (
              <div
                key={project.id}
                onClick={() => {
                  if (isRenaming) return
                  setCurrentProject(project.id)
                  // 遵循 codex：切换项目 = 切换全局工作目录
                  setWorkspaceCwd(project.path)
                }}
                className={`group flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 transition-colors ${
                  active
                    ? 'border-primary/40 bg-accent text-accent-foreground'
                    : 'bg-card hover:bg-accent/50'
                }`}
              >
                <Folder className={`h-5 w-5 shrink-0 ${active ? '' : 'text-muted-foreground'}`} />
                <div className="min-w-0 flex-1">
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full rounded border border-input bg-background px-1.5 py-0.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  ) : (
                    <div
                      className="truncate text-sm font-medium"
                      title={project.name}
                      onDoubleClick={(e) => startRename(e, project)}
                    >
                      {project.name}
                    </div>
                  )}
                  <div
                    className="truncate text-xs font-mono text-muted-foreground"
                    title={project.path}
                  >
                    {project.path}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground/60">
                    {relativeTime(project.updatedAt)}
                  </div>
                </div>
                {!isRenaming && (
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => handleDelete(e, project)}
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                      title="删除项目"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
