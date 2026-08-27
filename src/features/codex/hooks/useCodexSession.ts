import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useCallback, useEffect } from 'react'

import { approveCodex, runCodex, stopCodex } from '@/services/codex'
import { useCodexStore, type CodexApproval } from '@/stores/useCodexStore'
import { useSecurityStore } from '@/stores/useSecurityStore'
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
  const pendingRunId = useCodexStore((s) => s.pendingRunId)
  const runningCommands = useCodexStore((s) => s.runningCommands)
  const approval = useCodexStore((s) => s.approval)

  // 组件挂载时监听事件（只执行一次）
  useEffect(() => {
    let cancelled = false
    let outputUnlisten: UnlistenFn | null = null
    let doneUnlisten: UnlistenFn | null = null

    /** 解析待执行/正在执行的命令（codex 的 command_execution item） */
    const handleCommandItem = (item: CodexItem) => {
      if (item.type !== 'command_execution') return
      const store = useCodexStore.getState()
      const cmdText = (item.command ?? '').trim()
      if (!cmdText) return
      if (item.status === 'in_progress' || item.status == null) {
        store.upsertRunningCommand({
          id: item.id || cmdText,
          command: cmdText,
          startedAt: Date.now(),
        })
      } else if (item.status === 'completed') {
        store.removeRunningCommand(item.id || cmdText)
        const outputText = (item.aggregated_output ?? '').trim()
        store.appendMessage({
          kind: 'tool',
          content: outputText ? `$ ${cmdText}\n${outputText}` : `$ ${cmdText}`,
          toolName: 'command_execution',
        })
      }
    }

    const handleJsonEvent = (data: unknown) => {
      const event = data as CodexJsonEvent
      const store = useCodexStore.getState()

      if (event.type === 'thread.started') {
        store.setThreadId(event.thread_id)
        store.appendOutput({
          text: `▸ 会话已创建 (ID: ${event.thread_id.slice(0, 8)}…)`,
          kind: 'system',
        })
      } else if (event.type === 'item.started') {
        // item.started 可能带 tool 或 command 信息
        const item = event.item as CodexItem
        if (item && typeof item === 'object' && 'type' in item) {
          handleCommandItem(item)
        }
      } else if (event.type === 'item.completed') {
        const item = event.item as CodexItem
        if (!item || typeof item !== 'object') return
        // 事件级幂等去重：同一 item 重复投递（监听器泄漏/StrictMode）只处理一次
        if (item.id && !store.markItemProcessed(item.id)) return
        if (item.type === 'agent_message') {
          // 存入全文，同时标记为打字机流式（显示层逐字）；id 用 appendMessage 返回的真实 id
          const msgId = store.appendMessage({ kind: 'agent', content: item.text })
          store.setStreaming({ id: msgId, full: item.text, shown: 0 })
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
        } else if (item.type === 'command_execution') {
          handleCommandItem(item)
        } else if (item.type === 'approval_request') {
          const approvalItem: CodexApproval = {
            id: item.id,
            command: item.command,
            description: item.description,
          }
          store.setApproval(approvalItem)
          store.appendMessage({
            kind: 'system',
            content: `需要审批: ${item.command || item.description || '未知操作'}`,
          })
        }
      } else if (event.type === 'turn.completed') {
        // 本轮结束，强制完成打字机（避免残留流式状态）
        store.setStreaming(null)
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
          store.setPendingRunId(null)
          store.setApproval(null)
          store.setRunningCommands([])
          store.setStreaming(null)
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
    const runId = crypto.randomUUID()

    store.setStatus('running')
    store.setExitCode(null)
    store.setUsage(null)
    store.setPendingRunId(runId)
    store.setApproval(null)
    store.setRunningCommands([])
    store.setStreaming(null)
    // 每个 run 内 item id 独立计数，跨 run 必须清空去重集合（否则 resume 新输出被误删）
    store.clearProcessedItems()

    try {
      await runCodex(command, { workdir, mode, threadId: store.threadId ?? undefined, runId })
      // 兜底：如果 done 事件丢失，强制更新状态
      if (useCodexStore.getState().status === 'running') {
        useCodexStore.getState().setStatus('done')
        useCodexStore.getState().setPendingRunId(null)
      }
    } catch (err) {
      useCodexStore.getState().appendOutput({
        text: `Failed to start codex: ${String(err)}`,
        kind: 'stderr',
      })
      useCodexStore.getState().setStatus('error')
      useCodexStore.getState().setPendingRunId(null)
    }
  }, [])

  // 停止当前运行
  const stop = useCallback(async () => {
    const runId = useCodexStore.getState().pendingRunId
    if (!runId) return
    try {
      await stopCodex(runId)
      useCodexStore.getState().appendOutput({ text: '▸ 已停止', kind: 'system' })
    } catch (err) {
      useCodexStore.getState().appendOutput({
        text: `停止失败: ${String(err)}`,
        kind: 'stderr',
      })
    }
  }, [])

  // 审批响应
  const respondApproval = useCallback(async (approve: boolean) => {
    const store = useCodexStore.getState()
    const runId = store.pendingRunId
    const approvalItem = store.approval
    if (!runId || !approvalItem) return
    try {
      const cmd = approvalItem.command || approvalItem.description || ''
      await approveCodex(runId, approve, cmd)
      store.setApproval(null)
      store.appendMessage({
        kind: 'system',
        content: approve ? '▸ 已允许该操作' : '▸ 已拒绝该操作',
      })
      // 刷新安全设置里的审批历史
      void useSecurityStore.getState().load()
    } catch (err) {
      store.appendOutput({ text: `审批写入失败: ${String(err)}`, kind: 'stderr' })
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

  return {
    status,
    output,
    messages,
    exitCode,
    threadId,
    usage,
    pendingRunId,
    runningCommands,
    approval,
    run,
    stop,
    respondApproval,
    clear,
    newSession,
  }
}
