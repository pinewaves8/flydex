import { invoke } from '@tauri-apps/api/core'

/**
 * Codex IPC 服务封装
 *
 * 前端调用后端的唯一入口，组件不直接调 invoke。
 */

/** 执行 codex exec 命令 */
export async function runCodex(command: string, workdir?: string): Promise<void> {
  await invoke('run_codex', { command, workdir: workdir ?? null })
}
