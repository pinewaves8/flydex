import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useCallback, useEffect } from 'react'

import { runCodex } from '@/services/codex'
import { useCodexStore } from '@/stores/useCodexStore'
import type { CodexEvent } from '@/types/codex'
import type { CodexJsonEvent, CodexItem } from '@/types/codexJson'

/**
 * Codex 会话 Hook
 *
 * 封装与 Tauri 后端的 codex exec 通信，
 * 解析 JSONL 输出，管理多轮对话会话。
 */
export function useCodexSession() {
  // 只订阅需要触发重渲染的状态
  const status = useCodexStore((s) => s.status)
  const messages = useCodexStore((s) => s.messages)
  const output = useCodexStore((s) => s.output)
  const exitCode = useCodexStore((s) => s.exitCode)
  const threadId = useCodexStore((s) => s.threadId)
  const usage = useCodexStore((s) => s.usage)

  // 组件挂载时监听事件（只执行一次）
  useEffect(() => {
    let cancelled = false
    let outputUnlisten: UnlistenFn | null = null
    let doneUnlisten: UnlistenFn | null = null

    const handleJsonEvent = (data: unknown) => {
      const event = data as CodexJsonEvent
      const store = useCodexStore.getState()

      if (event.type === 'thread.started') {
        store.setThreadId(event.thread_id)
        store.appendOutput({
          text: `▸ 会话已创建 (ID: ${event.thread_id.slice(0, 8)}…)`,
          kind: 'system',
        })
      } else if (event.type === 'item.completed') {
        const item = event.item as CodexItem
        if (item.type === 'agent_message') {
          store.appendMessage({ kind: 'agent', content: item.text })
        } else if (item.type === 'error') {
          // 过滤第三方模型的元数据缺失警告（无害）
          if (item.message.startsWith('Model metadata for')) {
            return
          }
          store.appendMessage({ kind: 'error', content: item.message })
        } else if (item.type === 'tool_call') {
          store.appendMessage({
            kind: 'tool',
            content: `调用工具: ${item.name}`,
            toolName: item.name,
            toolArgs: item.arguments,
          })
        } else if (item.type === 'approval_request') {
          store.appendMessage({
            kind: 'system',
            content: `需要审批: ${item.command || item.description || '未知操作'}`,
          })
        }
      } else if (event.type === 'turn.completed') {
        if (event.usage) {
          store.setUsage(event.usage)
          const tokens = event.usage.output_tokens ?? 0
          store.appendOutput({ text: `▸ 本轮完成，输出 ${tokens} tokens`, kind: 'system' })
        }
      }
    }

    const setupListeners = async () => {
      const out = await listen<CodexEvent>('codex-output', (event) => {
        const payload = event.payload
        const store = useCodexStore.getState()

        if (payload.type === 'Started') {
          store.appendOutput({
            text: `▸ Codex 已启动 (PID: ${payload.data.pid})，正在思考…`,
            kind: 'system',
          })
        } else if (payload.type === 'Json') {
          handleJsonEvent(payload.data)
        } else if (payload.type === 'Output') {
          store.appendOutput({ text: payload.data.text, kind: 'stdout' })
        } else if (payload.type === 'Error') {
          store.appendOutput({ text: payload.data.message, kind: 'stderr' })
        }
      })

      const done = await listen<CodexEvent>('codex-done', (event) => {
        const payload = event.payload
        if (payload.type === 'Done') {
          const store = useCodexStore.getState()
          store.setExitCode(payload.data.exit_code)
          store.setStatus(payload.data.exit_code === 0 ? 'done' : 'error')
        }
      })

      if (cancelled) {
        out()
        done()
        return
      }
      outputUnlisten = out
      doneUnlisten = done
    }

    setupListeners()

    return () => {
      cancelled = true
      outputUnlisten?.()
      doneUnlisten?.()
    }
  }, []) // 空依赖，只在挂载时执行一次

  // 发送指令
  const run = useCallback(async (command: string, workdir?: string) => {
    const store = useCodexStore.getState()
    const mode = store.threadId ? 'resume' : 'exec'

    store.setStatus('running')
    store.setExitCode(null)
    store.setUsage(null)

    try {
      await runCodex(command, { workdir, mode, threadId: store.threadId ?? undefined })
      // 兜底：如果 done 事件丢失，强制更新状态
      if (useCodexStore.getState().status === 'running') {
        useCodexStore.getState().setStatus('done')
      }
    } catch (err) {
      useCodexStore.getState().appendOutput({
        text: `Failed to start codex: ${String(err)}`,
        kind: 'stderr',
      })
      useCodexStore.getState().setStatus('error')
    }
  }, [])

  // 清空输出（保留 thread_id）
  const clear = useCallback(() => {
    useCodexStore.getState().reset()
  }, [])

  // 新建会话（清空 thread_id）
  const newSession = useCallback(() => {
    useCodexStore.getState().reset()
    useCodexStore.getState().setThreadId(null)
  }, [])

  return { status, output, messages, exitCode, threadId, usage, run, clear, newSession }
}
