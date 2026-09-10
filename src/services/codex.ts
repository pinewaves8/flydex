import { invoke } from '@tauri-apps/api/core'

/**
 * Codex IPC 服务封装
 *
 * 前端调用后端的唯一入口，组件不直接调 invoke。
 */

export type CodexExecMode = 'exec' | 'resume' | 'plan' | 'review'

/** 执行 codex 命令 */
export async function runCodex(
  command: string,
  options?: {
    workdir?: string
    mode?: CodexExecMode
    threadId?: string
    runId?: string
    model?: string | null
    images?: string[]
    sandbox?: string | null
  },
): Promise<string> {
  const runId = options?.runId ?? crypto.randomUUID()
  await invoke('run_codex', {
    command,
    workdir: options?.workdir ?? null,
    mode: options?.mode ?? null,
    threadId: options?.threadId ?? null,
    runId,
    model: options?.model ?? null,
    images: options?.images ?? null,
    sandbox: options?.sandbox ?? null,
  })
  return runId
}

/** 审批响应：向运行中的 codex 写入 y/n（command 用于记录审批历史） */
export async function approveCodex(
  runId: string,
  approve: boolean,
  command?: string,
  approvalId?: string,
): Promise<void> {
  await invoke('approve_codex', {
    runId,
    approve,
    command: command ?? null,
    approvalId: approvalId ?? null,
  })
}

/** 停止运行中的 codex */
export async function stopCodex(runId: string): Promise<void> {
  await invoke('stop_codex', { runId })
}
