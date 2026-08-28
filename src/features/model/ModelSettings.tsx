import { CheckCircle2, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { modelService } from '@/services/modelService'
import { useModelStore } from '@/stores/useModelStore'
import { REASONING_LEVELS } from '@/types/model'

/** 供应商内联编辑表单 */
function ProviderEditor({
  initial,
  onDone,
  onCancel,
}: {
  initial?: { id: string; name: string; base_url: string; api_key: string }
  onDone: (p: { id: string; name: string; base_url: string; api_key: string }) => Promise<void>
  onCancel: () => void
}) {
  const [id, setId] = useState(initial?.id ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? '')
  const [apiKey, setApiKey] = useState(initial?.api_key ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!id.trim() || !baseUrl.trim()) return
    setSaving(true)
    try {
      await onDone({
        id: id.trim(),
        name: name.trim() || id.trim(),
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
      })
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary'

  return (
    <div className="grid grid-cols-12 gap-2 rounded-lg border border-border bg-accent/40 p-3">
      <input
        className={`${inputCls} col-span-2`}
        placeholder="id（唯一，如 minimax）"
        value={id}
        onChange={(e) => setId(e.target.value)}
        disabled={!!initial}
      />
      <input
        className={`${inputCls} col-span-2`}
        placeholder="名称"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={`${inputCls} col-span-4`}
        placeholder="API Base URL（如 https://api.minimaxi.com/v1）"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
      />
      <input
        className={`${inputCls} col-span-3`}
        placeholder="API Key（留空则沿用已存值）"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <div className="col-span-1 flex items-center gap-1">
        <button
          onClick={() => void submit()}
          disabled={saving}
          className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : '保存'}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground"
          >
            取消
          </button>
        )}
      </div>
    </div>
  )
}

/** 模型内联编辑表单（新增/编辑共用） */
function ModelEditor({
  initial,
  providers,
  onDone,
  onCancel,
}: {
  initial?: { id: string; provider: string; context_window?: number | null }
  providers: { id: string; name: string }[]
  onDone: (m: { id: string; provider: string; context_window?: number }) => Promise<void>
  onCancel?: () => void
}) {
  const [id, setId] = useState(initial?.id ?? '')
  const [provider, setProvider] = useState(initial?.provider ?? '')
  const [ctx, setCtx] = useState(initial?.context_window ? String(initial.context_window) : '')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!id.trim() || !provider) return
    setSaving(true)
    try {
      await onDone({
        id: id.trim(),
        provider,
        context_window: ctx.trim() ? Number(ctx.trim()) : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary'

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-accent/40 p-3">
      <input
        className={`${inputCls} flex-1`}
        placeholder="模型 id（如 qwen2.5-coder:latest）"
        value={id}
        onChange={(e) => setId(e.target.value)}
      />
      <select className={inputCls} value={provider} onChange={(e) => setProvider(e.target.value)}>
        <option value="">选择供应商</option>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}（{p.id}）
          </option>
        ))}
      </select>
      <input
        className={`${inputCls} w-20`}
        placeholder="context"
        title="上下文窗口（tokens），可留空"
        value={ctx}
        onChange={(e) => setCtx(e.target.value)}
      />
      <button
        onClick={() => void submit()}
        disabled={saving}
        className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
      >
        {saving ? '保存中…' : '保存'}
      </button>
      {onCancel && (
        <button
          onClick={onCancel}
          className="rounded border border-border px-2 py-1 text-xs text-muted-foreground"
        >
          取消
        </button>
      )}
    </div>
  )
}

export function ModelSettings() {
  const config = useModelStore((s) => s.config)
  const load = useModelStore((s) => s.load)
  const setCurrentModel = useModelStore((s) => s.setCurrentModel)
  const setReasoningEffort = useModelStore((s) => s.setReasoningEffort)
  const applyConfig = useModelStore((s) => s.applyConfig)

  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [addingProvider, setAddingProvider] = useState(false)
  const [addingModel, setAddingModel] = useState(false)
  const [editingModel, setEditingModel] = useState<{
    id: string
    provider: string
    context_window?: number | null
  } | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; text: string; ok: boolean } | null>(
    null,
  )
  const [testingModel, setTestingModel] = useState<string | null>(null)
  const [modelTestResult, setModelTestResult] = useState<{
    id: string
    text: string
    ok: boolean
  } | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载模型配置…
      </div>
    )
  }

  const test = async (providerId: string) => {
    setTesting(providerId)
    setTestResult(null)
    try {
      const text = await modelService.testConnection(providerId)
      setTestResult({ id: providerId, text, ok: true })
    } catch (e) {
      setTestResult({ id: providerId, text: String(e), ok: false })
    } finally {
      setTesting(null)
    }
  }

  const saveProvider = async (p: {
    id: string
    name: string
    base_url: string
    api_key: string
  }) => {
    const cfg = await modelService.upsertProvider(p)
    applyConfig(cfg)
    setEditingProvider(null)
    setAddingProvider(false)
  }

  const removeProvider = async (id: string) => {
    if (!window.confirm(`删除供应商「${id}」及其下全部模型？`)) return
    const cfg = await modelService.deleteProvider(id)
    applyConfig(cfg)
  }

  const saveNewModel = async (m: { id: string; provider: string; context_window?: number }) => {
    const cfg = await modelService.upsertModel(m)
    applyConfig(cfg)
    setAddingModel(false)
  }

  // 编辑模型：保存新配置；若 id 变了则删除旧的
  const saveEditModel = async (m: { id: string; provider: string; context_window?: number }) => {
    let cfg = await modelService.upsertModel(m)
    if (editingModel && editingModel.id !== m.id) {
      cfg = await modelService.deleteModel(editingModel.id)
    }
    applyConfig(cfg)
    setEditingModel(null)
  }

  const removeModel = async (id: string) => {
    const cfg = await modelService.deleteModel(id)
    applyConfig(cfg)
  }

  // 测试单个模型（发最小对话请求，确认模型实际可用）
  const testModel = async (modelId: string) => {
    setTestingModel(modelId)
    setModelTestResult(null)
    try {
      const text = await modelService.testModel(modelId)
      setModelTestResult({ id: modelId, text, ok: true })
    } catch (e) {
      setModelTestResult({ id: modelId, text: String(e), ok: false })
    } finally {
      setTestingModel(null)
    }
  }

  const inputCls =
    'rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary'
  const selectCls = inputCls

  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">模型配置</h2>
      </div>

      {/* 当前模型 + 推理强度 */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-1.5 text-xs text-muted-foreground">全局默认模型</div>
          <select
            value={config.current_model}
            onChange={(e) => void setCurrentModel(e.target.value)}
            className={`${selectCls} w-full`}
          >
            {config.models.map((m) => {
              const provider = config.providers.find((p) => p.id === m.provider)
              return (
                <option key={m.id} value={m.id}>
                  {m.id}
                  {provider ? `（${provider.name}）` : ''}
                </option>
              )
            })}
          </select>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-1.5 text-xs text-muted-foreground">推理强度（reasoning effort）</div>
          <select
            value={config.reasoning_effort}
            onChange={(e) => void setReasoningEffort(e.target.value)}
            className={`${selectCls} w-full`}
          >
            {REASONING_LEVELS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 供应商 */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">
          供应商 <span className="opacity-60">（API Base + Key）</span>
        </h3>
        <button
          onClick={() => setAddingProvider(true)}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <Plus className="h-3 w-3" />
          添加供应商
        </button>
      </div>
      <div className="space-y-2">
        {addingProvider && (
          <ProviderEditor onDone={saveProvider} onCancel={() => setAddingProvider(false)} />
        )}
        {config.providers.map((p) => {
          const editing = editingProvider === p.id
          const showingTest = testResult?.id === p.id
          return (
            <div key={p.id} className="rounded-lg border border-border bg-card">
              {editing ? (
                <ProviderEditor
                  initial={p}
                  onDone={saveProvider}
                  onCancel={() => setEditingProvider(null)}
                />
              ) : (
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{p.name}</span>
                      <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {p.id}
                      </span>
                      {p.api_key ? (
                        <span className="flex items-center gap-1 text-[10px] text-green-600">
                          <CheckCircle2 className="h-3 w-3" /> Key 已配置
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-600">未配置 Key</span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {p.base_url}
                    </div>
                  </div>
                  {showingTest && (
                    <div
                      className={`max-w-[220px] text-right text-[10px] ${
                        testResult!.ok ? 'text-green-600' : 'text-red-500'
                      }`}
                    >
                      {testResult!.text}
                    </div>
                  )}
                  <button
                    onClick={() => void test(p.id)}
                    disabled={testing === p.id}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                  >
                    {testing === p.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    测试连接
                  </button>
                  <button
                    onClick={() => setEditingProvider(p.id)}
                    className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => void removeProvider(p.id)}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          )
        })}
        {config.providers.length === 0 && !addingProvider && (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            暂无供应商，点击「添加供应商」创建
          </div>
        )}
      </div>

      {/* 模型 */}
      <div className="mb-3 mt-5 flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">
          模型 <span className="opacity-60">（{config.models.length} 个）</span>
        </h3>
        <button
          onClick={() => setAddingModel(true)}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <Plus className="h-3 w-3" />
          添加模型
        </button>
      </div>
      <div className="space-y-1.5">
        {addingModel && (
          <ModelEditor
            providers={config.providers.map((p) => ({ id: p.id, name: p.name }))}
            onDone={saveNewModel}
            onCancel={() => setAddingModel(false)}
          />
        )}
        {editingModel && (
          <ModelEditor
            initial={editingModel}
            providers={config.providers.map((p) => ({ id: p.id, name: p.name }))}
            onDone={saveEditModel}
            onCancel={() => setEditingModel(null)}
          />
        )}
        {config.models.map((m) => {
          const showingModelTest = modelTestResult?.id === m.id
          return (
            <div
              key={m.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  config.current_model === m.id ? 'bg-primary' : 'bg-border'
                }`}
                title={config.current_model === m.id ? '当前模型' : '非当前'}
              />
              <span className="flex-1 font-mono text-xs">{m.id}</span>
              <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {m.provider}
              </span>
              {m.context_window ? (
                <span className="text-[10px] text-muted-foreground">
                  {(m.context_window / 1024).toFixed(0)}K
                </span>
              ) : null}
              {config.current_model === m.id && (
                <span className="text-[10px] text-primary">当前</span>
              )}
              {showingModelTest && (
                <span
                  className={`max-w-[240px] truncate text-[10px] ${
                    modelTestResult!.ok ? 'text-green-600' : 'text-red-500'
                  }`}
                  title={modelTestResult!.text}
                >
                  {modelTestResult!.text}
                </span>
              )}
              <button
                onClick={() => void testModel(m.id)}
                disabled={testingModel === m.id}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                title="测试该模型能否对话"
              >
                {testingModel === m.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                onClick={() => setEditingModel(m)}
                className="text-muted-foreground hover:text-foreground"
                title="编辑模型"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => void removeModel(m.id)}
                className="text-red-500 hover:text-red-400"
                title="删除模型"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
