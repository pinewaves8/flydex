import { invoke } from '@tauri-apps/api/core'
import {
  Boxes,
  CheckCircle2,
  Download,
  FolderGit2,
  Github,
  Globe,
  Loader2,
  Pencil,
  Play,
  Plug,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'

/** MCP Server 配置 */
export interface McpServer {
  name: string
  transport: 'stdio' | 'sse'
  command?: string
  args: string[]
  env: Record<string, string>
  url?: string
  approval_mode?: string
}

function emptyServer(): McpServer {
  return {
    name: '',
    transport: 'stdio',
    command: '',
    args: [],
    env: {},
    url: '',
    approval_mode: 'approve',
  }
}

// codex 合法值: auto / prompt / writes / approve（无 never/reject）
const APPROVAL_OPTIONS = [
  { value: '', label: '跟随全局审批' },
  { value: 'approve', label: '需要批准（默认）' },
  { value: 'auto', label: '自动允许（免审批）' },
  { value: 'prompt', label: '每次调用询问' },
  { value: 'writes', label: '仅写操作询问' },
]

/** MCP 模板市场（6.3）：常用 Server 一键接入 */
interface McpTemplate {
  key: string
  name: string
  label: string
  desc: string
  icon: React.ReactNode
  builtin?: boolean
  build: (() => Promise<McpServer>) | (() => McpServer)
}

const MCP_TEMPLATES: McpTemplate[] = [
  {
    key: 'web-search',
    name: 'web-search',
    label: 'flydex 网络工具',
    desc: '内置 web_search + web_fetch：联网搜索与网页抓取，零依赖，走本地 node 运行',
    icon: <Globe className="h-4 w-4" />,
    builtin: true,
    build: async () => {
      const server = await invoke<McpServer>('mcp_builtin_web_server')
      return server
    },
  },
  {
    key: 'github',
    name: 'github',
    label: 'GitHub',
    desc: '仓库、Issue、PR、代码搜索等 GitHub 操作。需设置 GITHUB_PERSONAL_ACCESS_TOKEN',
    icon: <Github className="h-4 w-4" />,
    build: () => ({
      name: 'github',
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@github/mcp-server'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
      approval_mode: 'approve',
    }),
  },
  {
    key: 'filesystem',
    name: 'filesystem',
    label: '文件系统',
    desc: '安全的文件读写与目录操作（限定在指定目录内）。可接入后编辑配置路径',
    icon: <FolderGit2 className="h-4 w-4" />,
    build: () => ({
      name: 'filesystem',
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\'],
      env: {},
      approval_mode: 'approve',
    }),
  },
  {
    key: 'playwright',
    name: 'playwright',
    label: 'Playwright 浏览器',
    desc: '浏览器自动化：打开网页、点击、填写表单、截图等。适合需要真实浏览器交互的场景',
    icon: <Play className="h-4 w-4" />,
    build: () => ({
      name: 'playwright',
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      env: {},
      approval_mode: 'approve',
    }),
  },
]

export function McpSettings() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<McpServer | null>(null)
  const [form, setForm] = useState<McpServer>(emptyServer())
  const [saving, setSaving] = useState(false)
  const [testBusy, setTestBusy] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ name: string; ok: boolean; msg: string } | null>(
    null,
  )

  const load = async () => {
    try {
      setServers(await invoke<McpServer[]>('mcp_list'))
      setError('')
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const startAdd = () => {
    setAdding(true)
    setEditing(null)
    setForm(emptyServer())
    setTestResult(null)
  }

  const startEdit = (s: McpServer) => {
    setEditing(s)
    setForm({ ...s, args: [...s.args], env: { ...s.env } })
    setTestResult(null)
  }

  const cancelEdit = () => {
    setAdding(false)
    setEditing(null)
    setForm(emptyServer())
    setTestResult(null)
  }

  const argsText = form.args.join(', ')
  const envText = Object.entries(form.env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const save = async () => {
    const name = form.name.trim()
    if (!name) {
      setError('请填写 Server 名称')
      return
    }
    if (form.transport === 'stdio' && !form.command?.trim()) {
      setError('stdio 传输需要填写启动命令')
      return
    }
    if (form.transport === 'sse' && !form.url?.trim()) {
      setError('SSE 传输需要填写 url')
      return
    }
    setSaving(true)
    try {
      const payload: McpServer = {
        ...form,
        name,
        command: form.command?.trim() || undefined,
        url: form.url?.trim() || undefined,
        args: argsText
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        env: Object.fromEntries(
          envText
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => {
              const i = l.indexOf('=')
              return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, '']
            }),
        ),
        approval_mode: form.approval_mode || undefined,
      }
      const list = await invoke<McpServer[]>('mcp_save', { server: payload })
      setServers(list)
      setError('')
      cancelEdit()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (s: McpServer) => {
    const ok = window.confirm(
      `确定删除 MCP Server「${s.name}」？\n删除后 Codex 将无法再调用该工具。`,
    )
    if (!ok) return
    try {
      const list = await invoke<McpServer[]>('mcp_remove', { name: s.name })
      setServers(list)
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }

  const test = async (s: McpServer) => {
    setTestBusy(s.name)
    setTestResult(null)
    try {
      const msg = await invoke<string>('mcp_test', { server: s })
      setTestResult({ name: s.name, ok: true, msg })
    } catch (e) {
      setTestResult({ name: s.name, ok: false, msg: String(e) })
    } finally {
      setTestBusy(null)
    }
  }

  const [templateBusy, setTemplateBusy] = useState<string | null>(null)

  /** 一键接入模板：构造 server 配置并写入 */
  const applyTemplate = async (t: McpTemplate) => {
    if (servers.some((s) => s.name === t.name)) {
      setError(`Server「${t.name}」已存在，可直接编辑或删除后重新接入。`)
      return
    }
    setTemplateBusy(t.key)
    setError('')
    try {
      const server = await t.build()
      const list = await invoke<McpServer[]>('mcp_save', { server })
      setServers(list)
    } catch (e) {
      setError(String(e))
    } finally {
      setTemplateBusy(null)
    }
  }

  if (loading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">加载 MCP 配置…</div>
  }

  return (
    <div className="space-y-6">
      {/* 顶部提示 */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
        MCP（Model Context Protocol）Server 为 Codex 提供外部工具（如 web-search）。 修改后需
        <b>重启 Codex 会话</b>（New）才生效。
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* 模板市场（6.3）：一键接入 */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          模板市场
          <span className="ml-1 text-xs opacity-60">（一键接入常用 Server）</span>
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MCP_TEMPLATES.map((t) => {
            const connected = servers.some((s) => s.name === t.name)
            return (
              <div key={t.key} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-primary/10 text-primary">
                    {t.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      {t.label}
                      {t.builtin && (
                        <span className="rounded bg-primary/10 px-1 py-px text-[10px] text-primary">
                          内置
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {t.name}
                    </div>
                  </div>
                  <button
                    onClick={() => void applyTemplate(t)}
                    disabled={connected || templateBusy === t.key}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs ${
                      connected
                        ? 'cursor-default bg-muted text-muted-foreground'
                        : 'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40'
                    }`}
                    title={connected ? '已接入' : '一键写入配置'}
                  >
                    {templateBusy === t.key ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : connected ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    {connected ? '已接入' : '接入'}
                  </button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t.desc}</p>
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          GitHub / Filesystem / Playwright 需本机安装 Node
          且首次运行会下载依赖；接入后可在下方列表编辑 （如补全
          Token、修改目录路径），并「测试」验证可启动。
        </p>
      </section>

      {/* Server 列表 */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            已配置 Server（{servers.length}）
          </h2>
          <button
            onClick={startAdd}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" /> 添加 Server
          </button>
        </div>
        {servers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            暂无 MCP Server。点击右上角「添加 Server」配置一个（如你的 web-search）。
          </div>
        ) : (
          <div className="space-y-2">
            {servers.map((s) => (
              <div key={s.name} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-2">
                  <Plug className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">{s.name}</span>
                  <span
                    className={`rounded border px-1.5 py-px text-[10px] ${
                      s.transport === 'sse'
                        ? 'border-sky-500/30 bg-sky-500/10 text-sky-400'
                        : 'border-primary/30 bg-primary/10 text-primary'
                    }`}
                  >
                    {s.transport === 'sse' ? 'SSE' : 'stdio'}
                  </span>
                  {s.approval_mode && (
                    <span className="rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground">
                      审批：
                      {s.approval_mode === 'approve'
                        ? '需审批'
                        : s.approval_mode === 'never'
                          ? '免审批'
                          : s.approval_mode}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => void test(s)}
                      disabled={testBusy === s.name}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent"
                    >
                      {testBusy === s.name ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Boxes className="h-3 w-3" />
                      )}
                      测试
                    </button>
                    <button
                      onClick={() => startEdit(s)}
                      className="rounded border border-border p-1 text-muted-foreground hover:bg-accent"
                      title="编辑"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => void remove(s)}
                      className="rounded border border-border p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                      title="删除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <div className="mt-1.5 break-all font-mono text-[11px] text-muted-foreground">
                  {s.transport === 'sse' ? s.url : `${s.command ?? ''} ${s.args.join(' ')}`.trim()}
                </div>
                {testResult?.name === s.name && (
                  <div
                    className={`mt-1.5 flex items-start gap-1.5 rounded border px-2 py-1 text-[11px] ${
                      testResult.ok
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : 'border-red-500/30 bg-red-500/10 text-red-400'
                    }`}
                  >
                    {testResult.ok ? (
                      <CheckCircle2 className="mt-px h-3 w-3 shrink-0" />
                    ) : (
                      <XCircle className="mt-px h-3 w-3 shrink-0" />
                    )}
                    <span className="break-all">{testResult.msg}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 编辑/新增表单 */}
      {(editing || adding) && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            {editing ? `编辑 Server：${editing.name}` : '添加 Server'}
          </h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  名称（唯一标识）
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                  placeholder="e.g. web-search"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">传输类型</label>
                <select
                  value={form.transport}
                  onChange={(e) =>
                    setForm({ ...form, transport: e.target.value as 'stdio' | 'sse' })
                  }
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                >
                  <option value="stdio">stdio（本地命令）</option>
                  <option value="sse">SSE（远程 url）</option>
                </select>
              </div>
            </div>

            {form.transport === 'stdio' ? (
              <>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">
                    启动命令（command）
                  </label>
                  <input
                    value={form.command ?? ''}
                    onChange={(e) => setForm({ ...form, command: e.target.value })}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm outline-none focus:border-primary"
                    placeholder="e.g. node"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">
                    参数（args，逗号分隔）
                  </label>
                  <input
                    value={argsText}
                    onChange={(e) =>
                      setForm({ ...form, args: e.target.value.split(',').map((a) => a.trim()) })
                    }
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm outline-none focus:border-primary"
                    placeholder="e.g. C:\llm\flydex\mcp\web-search-server.mjs"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">SSE 端点 url</label>
                <input
                  value={form.url ?? ''}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm outline-none focus:border-primary"
                  placeholder="e.g. http://localhost:3000/mcp"
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">
                环境变量（每行 KEY=VALUE）
              </label>
              <textarea
                value={envText}
                onChange={(e) =>
                  setForm({
                    ...form,
                    env: Object.fromEntries(
                      e.target.value
                        .split('\n')
                        .map((l) => l.trim())
                        .filter(Boolean)
                        .map((l) => {
                          const i = l.indexOf('=')
                          return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, '']
                        }),
                    ),
                  })
                }
                className="h-16 w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm outline-none focus:border-primary"
                placeholder="API_KEY=xxx"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">工具审批模式</label>
              <select
                value={form.approval_mode ?? ''}
                onChange={(e) => setForm({ ...form, approval_mode: e.target.value || undefined })}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
              >
                {APPROVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void save()}
                disabled={saving}
                className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                保存
              </button>
              {editing && (
                <button
                  onClick={cancelEdit}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
                >
                  取消
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
