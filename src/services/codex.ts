import { invoke } from '@tauri-apps/api/core'

/**
 * Codex IPC 服务封装
 *
 * 前端调用后端的唯一入口，组件不直接调 invoke。
 */

export type CodexExecMode = 'exec' | 'resume'

/** 执行 codex 命令 */
export async function runCodex(
  command: string,
  options?: {
    workdir?: string
    mode?: CodexExecMode
    threadId?: string
  },
): Promise<void> {
  await invoke('run_codex', {
    command,
    workdir: options?.workdir ?? null,
    mode: options?.mode ?? null,
    threadId: options?.threadId ?? null,
  })
}
