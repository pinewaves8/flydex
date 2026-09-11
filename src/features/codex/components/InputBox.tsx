import { invoke } from '@tauri-apps/api/core'
import { Play, ShieldAlert, ListChecks, FolderOpen, ImagePlus, Loader2, X } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'

import { CommandPalette } from './CommandPalette'
import { FileMention } from './FileMention'
import { MemorySettle } from './MemorySettle'

import { listWorkdirFiles } from '@/services/initService'
import { useCodexStore } from '@/stores/useCodexStore'
import { useSecurityStore } from '@/stores/useSecurityStore'
import { approvalLabel } from '@/types/security'

/** 把字符串转 base64 data URL(用于图片附件预览 + 落盘) */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** 输入框属性 —— 父组件只传稳定引用,内部不订阅 store */
export interface InputBoxProps {
  status: 'idle' | 'running' | 'done' | 'error'
  threadId: string | null
  /** 待审批项(从 useCodexSession 透传);null 表示无审批 */
  approval: import('@/stores/useCodexStore').CodexApproval | null
  /** 审批回调(true=允许, false=拒绝) —— 父组件传入稳定引用 */
  respondApproval: (approve: boolean) => void | Promise<void>
  /** 真实发送逻辑(父组件 ChatPanel 已封装) */
  onSend: (command: string, attachments: Attachment[]) => Promise<void> | void
  /** 通过 store 拿不到的非响应式上下文(避免 InputBox 订阅) */
  currentSessionWorkdir: string | null | undefined
  workspaceCwd: string | null
  planMode: boolean
  /** 用来在新建会话后跳转视图;父组件传 setCurrentView('codex') 即可 */
  onAfterSend?: () => void
}

export interface Attachment {
  name: string
  dataUrl: string
  path: string
  saving: boolean
}

/**
 * 聊天输入区(性能优化:独立子组件)
 *
 * 把所有输入相关本地 state(command / attachments / dragOver / pendingSavesRef)
 * 下放到本组件,父组件 ChatPanel 不订阅这些 state。
 * 这样:
  1. 用户敲字 → InputBox 单独 re-render,消息列表完全不动
  2. 流式输出 → 父组件 streaming 变化不会触发输入区 re-render
 */
const InputBoxInner = function InputBox({
  status,
  threadId,
  approval,
  respondApproval,
  onSend,
  currentSessionWorkdir,
  workspaceCwd,
  planMode,
  onAfterSend,
}: InputBoxProps) {
  // ── 本地状态(独立于父组件) ──
  const [command, setCommand] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  // `/` 命令面板(对齐 Claude Code):输入 `/` 开头时打开,实时按字母筛选
  const commandPaletteOpen = command.startsWith('/') && !command.includes(' ')
  // 提取 query(包含前导 `/` 后面所有内容)
  const paletteQuery = command.startsWith('/') ? command.split(' ')[0] : '/'
  // `@`-mention 文件补全:工作目录的所有文件(workspaceCwd 变化时刷新)
  const [allFiles, setAllFiles] = useState<string[]>([])
  // 从 command 提取最后一个 @ 后的 query(在空格前)
  // 例如 "改一下 @App.tsx 那段代码" → "@App.tsx"
  const mentionMatch = /@([^@\s]*)$/.exec(command)
  const fileMentionOpen = mentionMatch !== null && !command.includes('/ ') // 排除 `/` 命令
  const fileMentionQuery = mentionMatch?.[1] ?? ''
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // 落盘中的附件计数 + 已落盘路径(发送时等待 pending 归零后读取)
  const pendingSavesRef = useRef(0)
  const savedPathsRef = useRef<string[]>([])

  // 输入框 autofocus:每次 status 变 done/error 时(运行结束)把焦点还给输入框
  useEffect(() => {
    if (status === 'done' || status === 'error') {
      inputRef.current?.focus()
    }
  }, [status])

  // 监听外部触发的 pendingCommand(如 SkillPalette 选中技能 → 写入命令前缀)
  // 这里 InputBox 是唯一订阅点,父组件不需要重新渲染
  const pendingCommand = useCodexStore((s) => s.pendingCommand)
  useEffect(() => {
    if (pendingCommand != null) {
      setCommand(pendingCommand)
      useCodexStore.getState().setPendingCommand(null)
      inputRef.current?.focus()
    }
  }, [pendingCommand])

  // 加载工作目录的所有文件(@-mention 用),workspaceCwd 变化时刷新
  useEffect(() => {
    if (!workspaceCwd) {
      setAllFiles([])
      return
    }
    let cancelled = false
    listWorkdirFiles(workspaceCwd, 3)
      .then((files) => {
        if (!cancelled) setAllFiles(files)
      })
      .catch(() => {
        if (!cancelled) setAllFiles([])
      })
    return () => {
      cancelled = true
    }
  }, [workspaceCwd])

  /** FileMention 选中:把 @filename 插入到当前光标位置 */
  const handleFileMentionSelect = useCallback((filename: string) => {
    // 替换最后那个 @query 为 @filename
    setCommand((prev) => prev.replace(/@[^\s]*$/, `@${filename} `))
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  /** FileMention 关闭:把 @ 部分字符清掉 */
  const handleFileMentionClose = useCallback(() => {
    setCommand((prev) => prev.replace(/@[^\s]*$/, ''))
    inputRef.current?.focus()
  }, [])

  /** 附加一个图片文件:转 base64 → 调后端落盘 → 存入 attachments */
  const addImageFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return
      const workdir = currentSessionWorkdir ?? workspaceCwd ?? ''
      if (!workdir) {
        useCodexStore.getState().appendOutput({
          text: '附加图片前请先打开/选择一个工作目录。',
          kind: 'stderr',
        })
        return
      }
      const dataUrl = await fileToDataUrl(file)
      pendingSavesRef.current += 1
      setAttachments((prev) => [...prev, { name: file.name, dataUrl, path: '', saving: true }])
      try {
        const relPath = (await invoke('save_attachment_image', {
          workdir,
          fileName: file.name,
          data: dataUrl,
        })) as string
        savedPathsRef.current.push(relPath)
        setAttachments((prev) =>
          prev.map((a) => (a.dataUrl === dataUrl ? { ...a, path: relPath, saving: false } : a)),
        )
      } catch (e) {
        setAttachments((prev) => prev.filter((a) => a.dataUrl !== dataUrl))
        useCodexStore.getState().appendOutput({
          text: `保存图片失败: ${String(e)}`,
          kind: 'stderr',
        })
      } finally {
        pendingSavesRef.current -= 1
      }
    },
    [currentSessionWorkdir, workspaceCwd],
  )

  const removeAttachment = useCallback(
    (dataUrl: string) => setAttachments((prev) => prev.filter((a) => a.dataUrl !== dataUrl)),
    [],
  )

  const pickImages = useCallback(() => fileInputRef.current?.click(), [])

  /** 粘贴截图/图片 */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            void addImageFile(file)
          }
          return
        }
      }
    },
    [addImageFile],
  )

  /** 拖拽图片到输入区 */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const files = e.dataTransfer?.files
      if (!files) return
      for (const file of Array.from(files)) {
        void addImageFile(file)
      }
    },
    [addImageFile],
  )

  /** 发送按钮 / Enter */
  const handleRun = useCallback(async () => {
    // 注意:运行中**不再拦截** —— 这句话会作为插话注入当前轮(turn/steer)。
    // 只有内容为空时才不发。
    if (!command.trim() && attachments.length === 0) return
    let cmd = command.trim()
    // 纯图片发送:注入默认指令(后端也有兜底,这里前端友好提示文案)
    if (!cmd && attachments.length > 0) {
      cmd = '请描述你看到的图片内容,并结合项目上下文给出分析和建议。'
    }
    setCommand('')
    requestAnimationFrame(() => inputRef.current?.focus())
    // 等待图片附件全部落盘完成(pending 归零)后再发送
    if (pendingSavesRef.current > 0) {
      const deadline = Date.now() + 5000
      while (pendingSavesRef.current > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    const imagePaths = savedPathsRef.current.slice()
    await onSend(cmd, attachments)
    // 发送后清空附件(图片已交给父组件,本地引用清掉)
    if (imagePaths.length > 0) {
      savedPathsRef.current = []
      setAttachments([])
    }
    onAfterSend?.()
  }, [command, attachments, onSend, onAfterSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // 注意:`/` 命令面板 + `@`-mention 都自己挂载 window keydown 监听,
      // 上箭头/下箭头/Enter/Escape 被它们拦截。这里只需处理 plan mode + 发送消息。
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        useCodexStore.getState().setPlanMode(!useCodexStore.getState().planMode)
        return
      }
      // Enter 发送(Shift+Enter 换行)
      // 但当 palette open(命令面板或文件补全)时,Enter 由它们处理(选中命令/文件),
      // 这里 preventDefault 阻止默认行为,不调用 handleRun。
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!commandPaletteOpen && !fileMentionOpen) {
          void handleRun()
        }
        // palette/mention open 时不调用 handleRun,留给对应的 window listener
      }
    },
    [handleRun, commandPaletteOpen, fileMentionOpen],
  )

  /** CommandPalette 选中命令:替换 input 值为选中命令(让用户继续输入参数) */
  const handlePaletteSelect = useCallback((cmdName: string) => {
    setCommand(`/${cmdName} `)
    // 立即让 input 重新获得焦点(用户继续输入参数)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  /** CommandPalette 关闭:删除命令前缀字符,恢复普通输入 */
  const handlePaletteClose = useCallback(() => {
    setCommand('')
    inputRef.current?.focus()
  }, [])

  const securityConfig = useSecurityStore((s) => s.config)

  return (
    <div className="border-t border-border p-3">
      {approval && (
        <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
              <ShieldAlert className="h-3.5 w-3.5" />
              需要审查
            </div>
            <span className="text-[10px] text-amber-300/60">
              策略:{approvalLabel(securityConfig?.approval_policy ?? 'on-request')}
            </span>
          </div>
          <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-xs text-amber-200">
            {approval.command || approval.description || '未知操作'}
          </pre>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void respondApproval(true)}
              className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-500"
            >
              允许
            </button>
            <button
              onClick={() => void respondApproval(false)}
              className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500"
            >
              拒绝
            </button>
          </div>
        </div>
      )}
      {/* 记忆沉淀入口(v4.1):会话完成后提炼候选 → 勾选 → 写入项目记忆 */}
      <MemorySettle workdir={currentSessionWorkdir ?? workspaceCwd ?? ''} />

      {/* Plan Mode 显眼 badge —— 对齐 Claude Code:开启时明显提示,一键关闭 */}
      {planMode && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
          <ListChecks className="h-3.5 w-3.5 shrink-0" />
          <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="font-semibold">Plan Mode 已开启</span>
            <span className="hidden text-amber-300/70 sm:inline">
              — AI 只会输出计划,不执行写操作
            </span>
          </div>
          <button
            onClick={() => useCodexStore.getState().setPlanMode(false)}
            disabled={status === 'running'}
            title="关闭 Plan Mode,让 AI 直接执行(对齐 Claude Code 默认行为)"
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
          >
            <X className="h-3 w-3" />
            <span className="text-[10px]">关闭</span>
          </button>
        </div>
      )}

      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => useCodexStore.getState().setPlanMode(!planMode)}
          disabled={status === 'running'}
          className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
            planMode
              ? 'text-muted-foreground hover:bg-accent hover:text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
          title={
            planMode
              ? 'Plan Mode 已开启(上方 badge 可一键关闭)'
              : '开启 Plan Mode:发送后先生成可编辑的分步计划,批准后再执行'
          }
        >
          <ListChecks className="h-3 w-3" />
          {planMode ? 'Plan · 已开启' : 'Plan'}
        </button>
        {!planMode && (
          <span className="text-[10px] text-muted-foreground/50">
            点击开启 Plan Mode(默认直接执行)
          </span>
        )}
      </div>
      <div className="mb-2 flex items-center gap-1.5">
        <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span
          className="truncate font-mono text-[11px] text-muted-foreground"
          title={currentSessionWorkdir ?? workspaceCwd ?? ''}
        >
          {currentSessionWorkdir ?? workspaceCwd ?? ''}
        </span>
        {currentSessionWorkdir && currentSessionWorkdir !== workspaceCwd && (
          <span className="shrink-0 text-[10px] text-muted-foreground/60">
            (会话目录,非当前工作目录)
          </span>
        )}
      </div>
      {/* 图片附件缩略图预览 */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div
              key={a.dataUrl}
              className="relative h-16 w-16 overflow-hidden rounded border border-border"
            >
              <img
                src={a.dataUrl}
                alt={a.name}
                className="h-full w-full object-cover"
                title={a.name}
              />
              {a.saving && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                </div>
              )}
              <button
                onClick={() => removeAttachment(a.dataUrl)}
                className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                title="移除图片"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="relative flex gap-2">
        {/* `/` 命令面板:对齐 Claude Code 风格,输入 / 弹出常用命令 + 字母筛选 */}
        {commandPaletteOpen && (
          <CommandPalette
            query={paletteQuery}
            onSelect={handlePaletteSelect}
            onClose={handlePaletteClose}
          />
        )}
        {/* `@`-mention 文件补全:对齐 Claude Code 风格,输入 @ + 文件名筛选 */}
        {fileMentionOpen && (
          <FileMention
            query={fileMentionQuery}
            files={allFiles}
            onSelect={handleFileMentionSelect}
            onClose={handleFileMentionClose}
          />
        )}
        {/* 隐藏的文件选择 input:多选图片 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files
            if (files) {
              for (const f of Array.from(files)) void addImageFile(f)
            }
            e.target.value = ''
          }}
        />
        <button
          onClick={pickImages}
          disabled={status === 'running'}
          className="flex items-center gap-1.5 rounded border border-input bg-background px-2 py-2 text-muted-foreground hover:bg-accent disabled:opacity-50"
          title="附加图片(也可拖拽到输入框或直接粘贴截图)"
        >
          <ImagePlus className="h-4 w-4" />
        </button>
        <textarea
          ref={inputRef}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          placeholder={
            status === 'running'
              ? '正在执行 —— 输入会**插话**到当前轮(Enter 插话)'
              : threadId
                ? 'Continue conversation... (Enter to send, Shift+Enter for newline)'
                : 'Enter your message... (Enter to send, Shift+Enter for newline, paste/drop image)'
          }
          rows={2}
          className={`flex-1 resize-none rounded border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring ${
            dragOver ? 'border-primary ring-1 ring-primary' : 'border-input'
          }`}
        />
        <button
          onClick={() => void handleRun()}
          disabled={!command.trim() && attachments.length === 0}
          className="flex items-center gap-1.5 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          {threadId ? 'Send' : 'Start'}
        </button>
      </div>
    </div>
  )
}

export const InputBox = memo(InputBoxInner)
