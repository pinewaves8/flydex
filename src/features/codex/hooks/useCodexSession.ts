import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useCallback, useEffect } from 'react'

import { approveCodex, runCodex, stopCodex, type CodexExecMode } from '@/services/codex'
import { notificationService } from '@/services/notificationService'
import { useCodexStore, type CodexApproval } from '@/stores/useCodexStore'
import { useSecurityStore } from '@/stores/useSecurityStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import type { CodexEvent } from '@/types/codex'
import type { CodexFileChange, CodexItem, CodexJsonEvent, TurnStats } from '@/types/codexJson'

/** 从 MCP/工具 result 提取摘要（首行 200 字） */
function summarizeToolResult(result: unknown): string {
  if (result === null || result === undefined) return ''
  let text: string
  if (typeof result === 'string') {
    text = result
  } else {
    try {
      text = JSON.stringify(result)
    } catch {
      text = String(result)
    }
  }
  // 取首行（去掉换行）
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? text
  const trimmed = firstLine.trim()
  if (trimmed.length > 200) return trimmed.slice(0, 200) + '…'
  return trimmed
}

/**
 * Codex 会话 Hook
 *
 * 封装与 Tauri 后端的 codex exec 通信，
 * 解析 JSONL 输出，管理多轮对话会话。
 */
export function useCodexSession() {
  // 跨 useEffect 和 run 回调共享：最近一次用户输入（反思用）
  let lastUserInputForReflect = ''
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
    // 本轮工作统计（turn_summary 用）
    const turnStats: TurnStats = {
      durationMs: 0,
      toolCalls: 0,
      mcpCalls: 0,
      fileChanges: 0,
      hadErrors: false,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    // 上次 turn 结束时的 turnStats 快照（用于反思）
    let lastTurnStatsForReflect: TurnStats | null = null
    // 上次 turn 结束时的最近消息（用于反思）
    let lastRecentMessagesForReflect: typeof messages = []
    // item id → 开始时间（用于计算耗时）
    const itemStartedAt = new Map<string, number>()

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
        // 计算耗时：从 itemStartedAt map 取，没有就给 0
        const startedAt = item.id ? itemStartedAt.get(item.id) : undefined
        const durationMs = startedAt ? Date.now() - startedAt : undefined
        if (item.id) itemStartedAt.delete(item.id)
        // 结果摘要：第一行输出，去掉 ANSI
        const resultSummary = outputText
          ? (outputText
              .split('\n')
              .find((l) => l.trim().length > 0)
              ?.trim()
              .slice(0, 200) ?? '')
          : ''
        const timeBadge = durationMs != null ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''
        store.appendMessage({
          kind: 'tool',
          content: `$ ${cmdText}${timeBadge}${outputText ? `\n${outputText}` : ''}`,
          toolName: 'command_execution',
          durationMs,
          toolResult: resultSummary || undefined,
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
          turnStats.fileChanges += fresh.length
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
      } else if (event.type === 'error') {
        // 模型 API 错误/重连提示（如 "Reconnecting... high demand"）：显示给用户，
        // 避免 codex 卡在重连时前端一直 running 却无任何反馈。
        store.appendOutput({ text: `⚠️ ${event.message}`, kind: 'stderr' })
      } else if (event.type === 'turn.started') {
        // 新的一轮：重置计划/审查消息追踪（每轮独立）
        lastPlanMsgId = null
        lastReviewMsgId = null
        // 重置本轮统计
        turnStats.toolCalls = 0
        turnStats.mcpCalls = 0
        turnStats.fileChanges = 0
        turnStats.hadErrors = false
      } else if (event.type === 'item.started') {
        // item.started 可能带 tool 或 command 信息
        const item = event.item as CodexItem
        if (item && typeof item === 'object' && 'type' in item) {
          // 记录开始时间（用于计算耗时）
          if (item.id) {
            itemStartedAt.set(item.id, Date.now())
          }
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
          turnStats.hadErrors = true
        } else if (item.type === 'tool_call') {
          turnStats.toolCalls++
          // 计算耗时（item.started 到 item.completed）
          const startedAt = item.id ? itemStartedAt.get(item.id) : undefined
          const durationMs = startedAt ? Date.now() - startedAt : undefined
          if (item.id) itemStartedAt.delete(item.id)
          store.appendMessage({
            kind: 'tool',
            content: `调用工具: ${item.name}${durationMs != null ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''}`,
            toolName: item.name,
            toolArgs: item.arguments,
            durationMs,
          })
        } else if (item.type === 'mcp_tool_call') {
          turnStats.mcpCalls++
          // MCP 工具调用：展示 server·tool + 状态 + 结果摘要 + 耗时
          const toolName = item.server && item.tool ? `${item.server} · ${item.tool}` : 'MCP tool'
          const failed = item.status === 'failed'
          const errMsg = item.error?.message ? `：${item.error.message}` : ''
          const resultSummary = !failed ? summarizeToolResult(item.result) : ''
          const startedAt = item.id ? itemStartedAt.get(item.id) : undefined
          const durationMs = startedAt ? Date.now() - startedAt : undefined
          if (item.id) itemStartedAt.delete(item.id)
          const timeBadge = durationMs != null ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''
          const statusBadge = failed ? `（失败${errMsg}）` : '（完成）'
          store.appendMessage({
            kind: 'tool',
            content: `调用工具: ${toolName}${statusBadge}${timeBadge}`,
            toolName,
            toolArgs: item.arguments,
            durationMs,
            toolResult: resultSummary || undefined,
          })
        } else if (item.type === 'command_execution') {
          handleCommandItem(item)
        } else if (item.type === 'file_change') {
          // 文件变更：对话流插入 diff 卡片（内联展示，可展开看 diff、接受/拒绝回滚）
          const changes = item.changes ?? []
          if (changes.length > 0) {
            turnStats.fileChanges += changes.length
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
          const decision = item.decision ?? 'ask'
          const approvalItem: CodexApproval = {
            id: item.id,
            command: item.command,
            description: item.description,
            decision,
            reason: item.reason,
          }
          const opText = item.command || item.description || '未知操作'
          if (decision === 'ask') {
            // 规则引擎 ask：弹审批卡等用户决定
            store.setApproval(approvalItem)
            store.appendMessage({
              kind: 'system',
              content: `需要审批: ${opText}`,
            })
            if (useSettingsStore.getState().notifyOnApproval) {
              void notificationService.notify('Flydex · 需要审批', opText)
            }
          } else if (decision === 'auto_accept') {
            // 规则 allow / 全自动：自动放行，仅通知（审计在 Rust 侧记录）
            store.appendMessage({
              kind: 'system',
              content: `▸ 已自动放行: ${opText}${item.reason ? `（${item.reason}）` : ''}`,
            })
          } else if (decision === 'auto_deny') {
            // deny 命中：执行前直接拒绝，卡片化展示（命令 + 命中原因）
            store.appendMessage({
              kind: 'deny',
              content: opText,
              reason: item.reason,
            })
          }
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
        // 收集本轮统计 + 生成 turn_summary 卡（Claude Code 风格反馈）
        const startedAt = store.runStartedAt
        if (startedAt != null) {
          turnStats.durationMs = Date.now() - startedAt
        }
        if (event.usage) {
          store.setUsage(event.usage)
          turnStats.inputTokens = event.usage.input_tokens ?? 0
          turnStats.outputTokens = event.usage.output_tokens ?? 0
          turnStats.reasoningTokens = event.usage.reasoning_output_tokens ?? 0
          turnStats.cacheReadTokens = event.usage.cached_input_tokens ?? 0
          turnStats.cacheWriteTokens = event.usage.cache_write_input_tokens ?? 0
        }
        // 保存本轮快照给反思用（深拷贝避免后续被覆盖）
        lastTurnStatsForReflect = { ...turnStats }
        // 取最近 3 条消息（快照）
        const allMsgs = useCodexStore.getState().messages
        lastRecentMessagesForReflect = allMsgs.slice(-3)
        // 只有产生实际工作（工具调用/文件变更/MCP/错误）才生成摘要卡，
        // 避免纯对话轮次也弹一张空摘要
        const hasActivity =
          turnStats.toolCalls + turnStats.mcpCalls + turnStats.fileChanges > 0 ||
          turnStats.hadErrors
        if (hasActivity) {
          store.appendMessage({
            kind: 'turn_summary',
            content: '',
            turnStats: { ...turnStats },
          })
        } else {
          // 保留向后兼容的 system 输出
          const tokens = turnStats.outputTokens
          const elapsed = (turnStats.durationMs / 1000).toFixed(1)
          store.appendOutput({
            text: `▸ 本轮完成，输出 ${tokens} tokens，耗时 ${elapsed}s`,
            kind: 'system',
          })
        }
      }
    }

    const setupListeners = async () => {
      const out = await listen<CodexEvent>('codex-output', (event) => {
        const payload = event.payload
        const store = useCodexStore.getState()

        // 子代理并行（6.3）：只处理本会话自己的 run，避免子代理事件污染主会话
        const myRunId = useCodexStore.getState().pendingRunId
        if (payload.run_id && payload.run_id !== myRunId) return

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
        // 子代理并行（6.3）：只处理本会话自己的 run
        const myRunId = useCodexStore.getState().pendingRunId
        if (payload.run_id && payload.run_id !== myRunId) return
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
          // 会话完成/失败通知（按设置开关控制）
          const settings = useSettingsStore.getState()
          if (payload.data.exit_code !== 0 && settings.notifyOnError) {
            void notificationService.notify('Flydex · 任务失败', 'codex 进程异常退出')
          } else if (payload.data.exit_code === 0 && settings.notifyOnDone) {
            void notificationService.notify('Flydex · 任务完成', '本轮会话已结束')
          }
          // 自我反思（Phase 1: Self-Reflection）：异步调用当前模型生成反思
          // 只在成功完成且有活动时触发
          if (
            payload.data.exit_code === 0 &&
            lastTurnStatsForReflect &&
            (lastTurnStatsForReflect.toolCalls +
              lastTurnStatsForReflect.mcpCalls +
              lastTurnStatsForReflect.fileChanges >
              0 ||
              lastTurnStatsForReflect.hadErrors)
          ) {
            void (async () => {
              const { reflect } = await import('@/services/reflectService')
              const content = await reflect({
                stats: lastTurnStatsForReflect!,
                lastUserInput: lastUserInputForReflect,
                recentMessages: lastRecentMessagesForReflect,
              })
              if (content) {
                useCodexStore.getState().appendMessage({
                  kind: 'reflection',
                  content,
                })
              }
            })()
          }
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
    async (
      command: string,
      workdir?: string,
      model?: string | null,
      mode?: CodexExecMode,
      images?: string[],
    ) => {
      const store = useCodexStore.getState()
      const execMode = mode ?? (store.threadId ? 'resume' : 'exec')
      const runId = crypto.randomUUID()
      // 记录本轮用户输入（反思需要）
      lastUserInputForReflect = command

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
          images,
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
      await approveCodex(runId, approve, cmd, approvalItem.id)
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
