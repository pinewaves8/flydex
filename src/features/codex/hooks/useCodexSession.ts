import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useCallback, useEffect } from 'react'

import { mapItemToMessage } from '@/features/codex/threadItems'
import { approveCodex, runCodex, stopCodex, type CodexExecMode } from '@/services/codex'
import { initStateService, type InitStep } from '@/services/initService'
// 实时与重载共用同一份 item → 消息映射(见 threadItems.ts 的模块文档)
import { notificationService } from '@/services/notificationService'
import {
  useCodexStore,
  appendLiveDelta,
  clearLive,
  type CodexApproval,
} from '@/stores/useCodexStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSecurityStore } from '@/stores/useSecurityStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import type { CodexEvent } from '@/types/codex'
import type { CodexFileChange, CodexItem, CodexJsonEvent, TurnStats } from '@/types/codexJson'

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
    // 本轮开始时的消息数（用于 turn.completed 时归并 file_change 卡片 —— Claude Code 风格）
    let turnStartMessageCount = 0

    /** Claude Code /init 风格:AI 写入关键文件 → 自动推进 init state
     *
     * 不依赖 file_change 消息(AI 用 shell here-string 写文件不会产生 file_change 事件),
     * 直接用 git_status_changes 检查工作区当前所有变更的文件。
     */
    const advanceInitState = async () => {
      const workdir = useCodexStore.getState().runWorkdir
      if (!workdir) return
      try {
        // 1. 读 init state
        const state = await initStateService.get(workdir)
        if (!state || state.step === 'done' || state.step === 'idle') return

        // 2. 检查工作区变更的文件(覆盖 file_change + command_execution 两种写文件方式)
        const changes = await invoke<Array<{ path: string; kind: string }>>('git_status_changes', {
          repo: workdir,
        })
        const lowerPaths = changes.map((c) => c.path.toLowerCase())
        const wroteAgents = lowerPaths.some(
          (p) => p.endsWith('agents.md') || p.endsWith('claude.md'),
        )
        const wroteRequirements = lowerPaths.some((p) => p.endsWith('requirements.md'))
        const wroteTechSpec = lowerPaths.some((p) => /tech[-_]?spec\.md$/.test(p))

        let nextStep: InitStep | null = null
        if (wroteAgents) {
          nextStep = 'done'
        } else if (
          wroteRequirements &&
          (state.step === 'scanned' || state.step === 'collecting-requirements')
        ) {
          nextStep = 'collecting-tech-spec'
        } else if (wroteTechSpec && state.step !== 'ready-to-generate') {
          nextStep = 'ready-to-generate'
        }

        if (nextStep) {
          await initStateService.set(state.workdir, state.scenario, nextStep)
          const file = wroteAgents
            ? 'AGENTS.md'
            : wroteRequirements
              ? 'requirements.md'
              : 'tech-spec.md'
          useCodexStore.getState().appendOutput({
            text: `[init] 自动推进: ${state.step} → ${nextStep}(检测到 ${file} 写入)`,
            kind: 'system',
          })
        }
      } catch {
        // 静默
      }
    }

    // item id → 开始时间（用于计算耗时）
    const itemStartedAt = new Map<string, number>()

    /**
     * 登记「正在执行的命令」(实时命令面板)
     *
     * 只管**开始**侧:完成侧(command_execution item 落地成 tool 卡片 + 摘掉面板)
     * 统一由 `mapItemToMessage` 之外的 item.completed 分支处理,避免两处各记一次。
     */
    const markRunningCommand = (item: CodexItem) => {
      if (item.type !== 'command_execution') return
      if (item.status !== 'in_progress' && item.status != null) return
      const cmdText = (item.command ?? '').trim()
      if (!cmdText) return
      useCodexStore.getState().upsertRunningCommand({
        id: item.id || cmdText,
        command: cmdText,
        startedAt: Date.now(),
      })
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
        // 记住活跃轮:插话要用它做 expectedTurnId
        if (event.turn_id) store.setLiveTurnId(event.turn_id)
        // 新的一轮：重置计划/审查消息追踪（每轮独立）
        lastPlanMsgId = null
        lastReviewMsgId = null
        // 重置本轮统计
        turnStats.toolCalls = 0
        turnStats.mcpCalls = 0
        turnStats.fileChanges = 0
        turnStats.hadErrors = false
        // 记录本轮开始时的消息数(用于 turn.completed 时归并 file_change 卡片)
        turnStartMessageCount = useCodexStore.getState().messages.length
        // 清掉上一轮的任务清单(等本轮的 turn/plan/updated 到达)
        store.setLivePlan(null)
      } else if (event.type === 'item.started') {
        // item.started 可能带 tool 或 command 信息
        const item = event.item as CodexItem
        if (item && typeof item === 'object' && 'type' in item) {
          // 记录开始时间（用于计算耗时）
          if (item.id) {
            itemStartedAt.set(item.id, Date.now())
          }
          markRunningCommand(item)
        }
      } else if (event.type === 'item.completed') {
        const item = event.item as CodexItem
        if (!item || typeof item !== 'object') return
        // 事件级幂等去重：同一 item 重复投递（监听器泄漏/StrictMode）只处理一次
        if (item.id && !store.markItemProcessed(item.id)) return

        // 第三方模型的无害提示：元数据缺失警告、跨模型 resume 提示（不影响功能）
        if (
          item.type === 'error' &&
          (item.message.startsWith('Model metadata for') ||
            item.message.startsWith('This session was recorded with model'))
        ) {
          return
        }

        // 本轮统计(turn_summary 卡用)
        if (item.type === 'tool_call') turnStats.toolCalls++
        else if (item.type === 'mcp_tool_call') turnStats.mcpCalls++
        else if (item.type === 'file_change') turnStats.fileChanges += item.changes?.length ?? 0
        else if (item.type === 'error') turnStats.hadErrors = true

        // 审批请求是 Flydex 侧的概念(规则引擎决策),codex 无对应 item,单独处理
        if (item.type === 'approval_request') {
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
            store.appendMessage({ kind: 'system', content: `需要审批: ${opText}` })
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
            store.appendMessage({ kind: 'deny', content: opText, reason: item.reason })
          }
          return
        }

        // 计划/审查模式：模型可能先输出探索说明再输出正式计划/报告。
        // 全部按 agent 消息暂存，turn 结束时把最后一条转成卡片。
        if (item.type === 'agent_message') {
          const st = useCodexStore.getState()
          if (st.planMode || st.reviewMode) {
            const msgId = store.appendCodexMessage({
              id: item.id,
              kind: 'agent',
              source: 'codex',
              turnId: event.turn_id ?? undefined,
              content: item.text,
              timestamp: Date.now(),
            })
            if (st.planMode) lastPlanMsgId = msgId
            else lastReviewMsgId = msgId
            clearLive()
            return
          }
        }

        // 命令跑完 → 摘掉实时面板(登记在 item.started 侧)
        if (item.type === 'command_execution') {
          useCodexStore.getState().removeRunningCommand(item.id || (item.command ?? '').trim())
        }

        // 旧的本地计时兜底(item 不带 duration_ms 时用它)
        const startedAt = item.id ? itemStartedAt.get(item.id) : undefined
        if (item.id) itemStartedAt.delete(item.id)

        // 与重载路径共用同一映射 —— 「实时」与「重载后」因此必然一致
        const mapped = mapItemToMessage(item, Date.now(), event.turn_id ?? undefined, {
          durationMs: startedAt != null ? Date.now() - startedAt : undefined,
        })
        if (!mapped) return
        clearLive()
        if (mapped.kind === 'tool') {
          // 完成瞬间的"叮"动画(0 token 消耗)
          useCodexStore.setState({ lastToolCompleteAt: Date.now() })
        } else if (mapped.kind === 'file_change' && mapped.fileChanges) {
          // 与 git 工作区兜底共用 seenFileChanges，避免重复卡片
          store.markFileChangesSeen(mapped.fileChanges.map((c) => `${c.path}|${c.kind}`))
        }
        store.appendCodexMessage(mapped)
      } else if (
        event.type === 'item.agent_message.delta' ||
        event.type === 'item.reasoning.delta' ||
        event.type === 'item.reasoning.summary.delta'
      ) {
        // 真实流式:回答 / 思考摘要 / 思考原文,分别累积到各自预览区
        const kind =
          event.type === 'item.agent_message.delta'
            ? 'agent'
            : event.type === 'item.reasoning.summary.delta'
              ? 'reasoning-summary'
              : 'reasoning'
        appendLiveDelta(kind, event.delta)
      } else if (event.type === 'turn.plan.updated') {
        // codex 原生的任务清单:交给 store,由 UI 面板实时渲染(取代旧的猜进度 + 轮询)
        store.setLivePlan({
          explanation: event.explanation ?? null,
          steps: event.plan,
        })
      } else if (event.type === 'turn.completed') {
        // 本轮结束，强制完成打字机（避免残留流式状态）
        clearLive()
        // 本轮已结束,不能再插话了
        store.setLiveTurnId(null)

        // /init 自动推进:直接查 git 工作区变更,根据写入的关键文档推进 init state
        void advanceInitState()

        // Claude Code 风格对齐:本 turn 内多次 file_change 事件会生成多张卡片,
        // turn 完成后把它们归并为一张(FileChangeCard 已支持多个 changes)
        const currentMessages = useCodexStore.getState().messages
        const turnFileChanges = currentMessages
          .slice(turnStartMessageCount)
          .filter((m) => m.kind === 'file_change')
        if (turnFileChanges.length > 1) {
          // 合并所有 changes 到第一条卡片,删除后续重复卡片
          const firstId = turnFileChanges[0].id
          const mergedChanges = turnFileChanges.flatMap((m) => m.fileChanges ?? [])
          // 统计行数(+add / -update 中旧内容 / 总变化)
          const dedupChanges: typeof mergedChanges = []
          const seen = new Set<string>()
          for (const c of mergedChanges) {
            const key = `${c.path}|${c.kind}`
            if (seen.has(key)) continue
            seen.add(key)
            dedupChanges.push(c)
          }
          useCodexStore.setState((state) => ({
            messages: state.messages
              .map((m) =>
                m.id === firstId
                  ? {
                      ...m,
                      fileChanges: dedupChanges,
                      content: `文件变更：${dedupChanges.map((c) => `${c.path}(${c.kind})`).join('，')}`,
                    }
                  : m,
              )
              .filter((m) => !(m.kind === 'file_change' && m.id !== firstId)),
          }))
        }

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
        // 静默失败检测:模型返回空(0 输出 + 本 turn 无任何 agent 消息)
        // 常见于:模型 ID 不被供应商支持 / 上下文超限 / 供应商返回空
        {
          const msgsThisTurn = useCodexStore.getState().messages.slice(turnStartMessageCount)
          const producedAgentOutput = msgsThisTurn.some(
            (m) => m.kind === 'agent' || m.kind === 'reasoning',
          )
          const outTokens = event.usage?.output_tokens ?? 0
          if (!producedAgentOutput && outTokens === 0 && !turnStats.hadErrors) {
            const inTok = event.usage?.input_tokens ?? 0
            store.appendMessage({
              kind: 'error',
              content:
                `⚠️ 模型返回了空响应(输出 0 tokens,输入 ${inTok} tokens)。
` +
                `可能原因:
` +
                `1. 模型 ID 不被当前供应商支持 — 检查「设置 → 模型配置」里的模型名
` +
                `2. 上下文超限 — 输入 ${inTok} tokens 可能超过模型窗口
` +
                `3. 供应商侧限流/异常 — 查看 app-server 日志(下方如有 [app-server] 报错即为根因)`,
            })
          }
        }

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
          clearLive()
          // 会话列表的权威源是 codex:本轮结束后刷新,新会话才会出现在侧边栏
          {
            const project = useProjectStore.getState()
            const tid = useCodexStore.getState().threadId
            // 草稿会话(还没认领)+ codex 已建出 thread → 认领并归属当前项目,
            // 归属完成后才刷新列表(否则新线程还没归到项目下,过滤后看不见)
            if (tid && !project.currentThreadId) {
              void project.adoptThread(tid).then(() => project.loadThreads())
            } else {
              void project.loadThreads()
            }
          }
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
      clearLive()
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
