import { ChevronDown, ChevronRight, File, Folder, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { listDirectory, type DirectoryEntry } from '@/services/filesService'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'

/** 大目录保护：单层文件超过该数只渲染前 N 行，避免 10,000 文件目录一次性渲染卡顿 */
const MAX_VISIBLE_FILES = 300

function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') || dir.endsWith('\\') ? dir + name : dir + '/' + name
}

/** 单个目录节点：点击懒加载下一层，缓存已加载内容 */
function TreeNode({ path, name, depth }: { path: string; name: string; depth: number }) {
  const [expanded, setExpanded] = useState(false)
  const [entry, setEntry] = useState<DirectoryEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const toggle = async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (!entry) {
      setLoading(true)
      try {
        setEntry(await listDirectory(path))
        setErr(null)
      } catch (e) {
        console.error('[files] list_directory failed:', e)
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }
  }

  const hasChildren = entry ? entry.dirs.length > 0 || entry.files.length > 0 : true
  const fileCount = entry?.files.length ?? 0
  const filesToShow = entry ? entry.files.slice(0, MAX_VISIBLE_FILES) : []

  return (
    <div className="select-none">
      <div
        className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[13px] hover:bg-accent/60"
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={toggle}
        title={path}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
        ) : expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        {!hasChildren && <span className="w-3 shrink-0" />}
        <Folder className="h-3.5 w-3.5 shrink-0 text-sky-500" />
        <span className="truncate">{name}</span>
      </div>

      {err && (
        <div
          className="px-1 py-0.5 text-[11px] text-destructive"
          style={{ paddingLeft: 4 + (depth + 1) * 14 }}
        >
          {err}
        </div>
      )}

      {expanded && entry && (
        <div>
          {entry.dirs.map((d) => (
            <TreeNode key={d.name} path={joinPath(path, d.name)} name={d.name} depth={depth + 1} />
          ))}
          {filesToShow.map((f) => (
            <div
              key={f}
              className="flex cursor-default items-center gap-1 rounded px-1 py-0.5 text-[13px] text-muted-foreground hover:bg-accent/40"
              style={{ paddingLeft: 4 + (depth + 1) * 14 }}
              title={joinPath(path, f)}
            >
              <span className="w-3 shrink-0" />
              <File className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{f}</span>
            </div>
          ))}
          {fileCount > MAX_VISIBLE_FILES && (
            <div
              className="px-1 py-0.5 text-[11px] text-muted-foreground"
              style={{ paddingLeft: 4 + (depth + 1) * 14 }}
            >
              共 {fileCount} 个文件，仅显示前 {MAX_VISIBLE_FILES} 个
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 工作区文件树视图（懒加载 + 缓存，大仓友好） */
export function FilesView() {
  const cwd = useWorkspaceStore((s) => s.cwd)
  const [root, setRoot] = useState<string>(cwd ?? '')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (cwd) setRoot(cwd)
  }, [cwd])

  const rootName = useMemo(() => {
    if (!root) return ''
    const parts = root.replace(/[\\/]+$/, '').split(/[\\/]/)
    return parts[parts.length - 1] || root
  }, [root])

  const refresh = () => setVersion((v) => v + 1)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">文件</span>
        <span className="truncate text-[11px] text-muted-foreground">{root}</span>
        <button
          onClick={refresh}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="刷新"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      {!root ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          未设置工作目录。请先在 Codex 中选择工作目录。
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2">
          <TreeNode key={`${root}-${version}`} path={root} name={rootName} depth={0} />
        </div>
      )}
    </div>
  )
}
