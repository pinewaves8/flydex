import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useCallback, useEffect } from 'react'

import { approveCodex, runCodex, stopCodex, type CodexExecMode } from '@/services/codex'
import { useCodexStore, type CodexApproval } from '@/stores/useCodexStore'
import { useSecurityStore } from '@/stores/useSecurityStore'
import type { CodexEvent } from '@/types/codex'
import type { CodexJsonEvent, CodexFileChange, CodexItem } from '@/types/codexJson'

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
    // 计划模式下模型可能在 turn 内多次输出 agent_message（探索说明 → 正式计划）。
    // 记录本轮最后一个 agent_message id，turn 结束时将其转换为计划卡片。
    let lastPlanMsgId: string | null = null
    // 审查模式同理：记录最后一个 agent_message，turn 结束时转为审查报告卡片
    let lastReviewMsgId: string | null = null

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

      /**
       * 写入后审查兜底：部分场景（Windows/PowerShell 下模型用 shell 写文件）没有
       * file_change 事件。本轮结束时对比 git 工作区，把实际发生的文件变更生成卡片。
       */
      const checkFileChanges = async (workdir: string | null | undefined) => {
        const st = useCodexStore.getState()
        if (!workdir) return
        try {
          const changes = await invoke<CodexFileChange[]>('git_status_changes', {
            repo: workdir,
          })
          // 只展示本轮新增的变更：排除 run 开始时的快照 + 已展示过的
          const baseline = st.baselineFileChanges
          const seen = new Set(st.seenFileChanges)
          const fresh = changes.filter(
            (c) =>
              !baseline.some((b) => b.path === c.path && b.kind === c.kind) &&
              !seen.has(`${c.path}|${c.kind}`),
          )
          if (fresh.length === 0) return
          const s = useCodexStore.getState()
          s.appendMessage({
            kind: 'file_change',
            content: `文件变更：${fresh.map((c) => `${c.path}（${c.kind}）`).join('，')}`,
            fileChanges: fresh,
          })
          s.markFileChangesSeen(fresh.map((c) => `${c.path}|${c.kind}`))
        } catch {
          // 非 git 仓库或命令失败时静默
        }
      }

      if (event.type === 'thread.started') {
        store.setThreadId(event.thread_id)
        store.appendOutput({
          text: `▸ 会话已创建 (ID: ${event.thread_id.slice(0, 8)}…)`,
          kind: 'system',
        })
      } else if (event.type === 'turn.started') {
        // 新的一轮：重置计划/审查消息追踪（每轮独立）
        lastPlanMsgId = null
        lastReviewMsgId = null
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
          const st = useCodexStore.getState()
          if (st.planMode) {
            // 计划模式：模型可能先输出探索/思考说明再输出正式计划。
            // 全部按 agent 消息暂存（不流式），turn 结束时最后一个转成计划卡片。
            const msgId = store.appendMessage({ kind: 'agent', content: item.text })
            lastPlanMsgId = msgId
            store.setStreaming(null)
            return
          }
          if (st.reviewMode) {
            // 审查模式：模型可能先输出过程说明再输出正式报告。
            // 全部按 agent 消息暂存，turn 结束时最后一个转成审查报告卡片。
            const msgId = store.appendMessage({ kind: 'agent', content: item.text })
            lastReviewMsgId = msgId
            store.setStreaming(null)
            return
          }
          // 存入全文，同时标记为打字机流式（显示层逐字）；id 用 appendMessage 返回的真实 id
          const msgId = store.appendMessage({ kind: 'agent', content: item.text })
          store.setStreaming({ id: msgId, full: item.text, shown: 0 })
        } else if (item.type === 'error') {
          // 过滤第三方模型的无害提示：元数据缺失警告、跨模型 resume 提示（不影响功能）
          if (
            item.message.startsWith('Model metadata for') ||
            item.message.startsWith('This session was recorded with model')
          ) {
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
        } else if (item.type === 'mcp_tool_call') {
          // MCP 工具调用：简洁展示（server·tool + 参数），不暴露巨大的 result JSON
          const toolName = item.server && item.tool ? `${item.server} · ${item.tool}` : 'MCP tool'
          const failed = item.status === 'failed'
          const errMsg = item.error?.message ? `：${item.error.message}` : ''
          store.appendMessage({
            kind: 'tool',
            content: `调用工具: ${toolName}${failed ? `（失败${errMsg}）` : '（完成）'}`,
            toolName,
            toolArgs: item.arguments,
          })
        } else if (item.type === 'command_execution') {
          handleCommandItem(item)
        } else if (item.type === 'file_change') {
          // 文件变更：对话流插入 diff 卡片（内联展示，可展开看 diff、接受/拒绝回滚）
          const changes = item.changes ?? []
          if (changes.length > 0) {
            const summary = changes.map((c) => `${c.path}（${c.kind}）`).join('，')
            store.appendMessage({
              kind: 'file_change',
              content: `文件变更：${summary}`,
              fileChanges: changes,
            })
            // 与 git 工作区兜底共用 seenFileChanges，避免重复卡片
            store.markFileChangesSeen(changes.map((c) => `${c.path}|${c.kind}`))
          }
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
        // 计划模式：把本轮最后一个 agent_message 转为计划卡片（前面的探索说明保持 agent）
        if (useCodexStore.getState().planMode && lastPlanMsgId) {
          store.updateMessageKind(lastPlanMsgId, 'plan')
          lastPlanMsgId = null
        }
        // 审查模式：最后一个 agent_message 转为审查报告卡片，并关闭临时审查态
        if (useCodexStore.getState().reviewMode && lastReviewMsgId) {
          store.updateMessageKind(lastReviewMsgId, 'review')
          lastReviewMsgId = null
          useCodexStore.getState().setReviewMode(false)
        }
        // 写入后审查兜底：git 工作区变化 → 生成文件变更卡片
        void checkFileChanges(store.runWorkdir)
        if (event.usage) {
          store.setUsage(event.usage)
          const tokens = event.usage.output_tokens ?? 0
          const startedAt = store.runStartedAt
          const elapsed = startedAt != null ? ((Date.now() - startedAt) / 1000).toFixed(1) : null
          store.appendOutput({
            text: `▸ 本轮完成，输出 ${tokens} tokens${elapsed != null ? `，耗时 ${elapsed}s` : ''}`,
            kind: 'system',
          })
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
          // 兜底：计划/审查模式下若本轮有 agent 消息但未转成卡片（turn.completed
          // 事件缺失/异常提前结束时），在进程结束前把最后一个 agent 消息转为卡片。
          if (useCodexStore.getState().planMode && lastPlanMsgId) {
            store.updateMessageKind(lastPlanMsgId, 'plan')
            lastPlanMsgId = null
          }
          if (useCodexStore.getState().reviewMode && lastReviewMsgId) {
            store.updateMessageKind(lastReviewMsgId, 'review')
            lastReviewMsgId = null
            useCodexStore.getState().setReviewMode(false)
          }
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
  const run = useCallback(
    async (command: string, workdir?: string, model?: string | null, mode?: CodexExecMode) => {
      const store = useCodexStore.getState()
      const execMode = mode ?? (store.threadId ? 'resume' : 'exec')
      const runId = crypto.randomUUID()

      store.setStatus('running')
      store.setExitCode(null)
      store.setUsage(null)
      store.setPendingRunId(runId)
      store.setRunStartedAt(Date.now())
      store.setApproval(null)
      store.setRunningCommands([])
      store.setStreaming(null)
      store.setRunWorkdir(workdir ?? null)
      // 记录本轮开始时的 git 工作区快照（turn 完成时只展示本轮新增的变更）
      if (workdir) {
        try {
          const baseline = await invoke<CodexFileChange[]>('git_status_changes', {
            repo: workdir,
          })
          useCodexStore.getState().setBaselineFileChanges(baseline)
        } catch {
          useCodexStore.getState().setBaselineFileChanges([])
        }
      } else {
        useCodexStore.getState().setBaselineFileChanges([])
      }
      // 每个 run 内 item id 独立计数，跨 run 必须清空去重集合（否则 resume 新输出被误删）
      store.clearProcessedItems()

      try {
        await runCodex(command, {
          workdir,
          mode: execMode,
          threadId: store.threadId ?? undefined,
          runId,
          model: model ?? null,
        })
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
    },
    [],
  )

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

  // 批准计划并执行：退出计划模式，resume 同一会话按批准的计划逐步执行
  const approvePlan = useCallback(
    async (steps: string[]) => {
      const store = useCodexStore.getState()
      const planText = steps
        .map((s, i) => `${i + 1}. ${s.trim()}`)
        .filter(Boolean)
        .join('\n')
      if (!planText) return
      const approvalCmd = `【计划已批准】请严格按以下已批准的计划逐步执行：\n${planText}`
      store.setPlanMode(false)
      store.appendMessage({
        kind: 'system',
        content: '▸ 计划已批准，开始执行',
      })
      await run(approvalCmd, store.runWorkdir ?? undefined, null)
    },
    [run],
  )

  // 取消计划：退出计划模式（计划卡片保留，可重新批准）
  const cancelPlan = useCallback(() => {
    useCodexStore.getState().setPlanMode(false)
    useCodexStore.getState().appendMessage({ kind: 'system', content: '▸ 已取消计划，等待新指令' })
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
    approvePlan,
    cancelPlan,
    clear,
    newSession,
  }
}
