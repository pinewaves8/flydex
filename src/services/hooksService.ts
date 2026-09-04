import { invoke } from '@tauri-apps/api/core'

import type { HookRunResult, HooksConfig } from '@/types/hooks'

/** 支持的全部 hook 事件（下拉用） */
export async function listHooksEvents(): Promise<string[]> {
  return invoke<string[]>('hooks_events')
}

/** 列出当前 hooks 配置 */
export async function listHooks(): Promise<HooksConfig> {
  return invoke<HooksConfig>('hooks_list')
}

/** 新增 hook（event 需合法、command 非空、同 event 同 command 幂等） */
export async function addHook(event: string, command: string, note: string): Promise<HooksConfig> {
  return invoke<HooksConfig>('hooks_add', { event, command, note })
}

/** 删除 hook（按 index） */
export async function removeHook(index: number): Promise<HooksConfig> {
  return invoke<HooksConfig>('hooks_remove', { index })
}

/** 清空 hooks */
export async function clearHooks(): Promise<HooksConfig> {
  return invoke<HooksConfig>('hooks_clear')
}

/** 测试执行一个 hook 命令（同步返回输出） */
export async function testHook(event: string, command: string): Promise<HookRunResult> {
  return invoke<HookRunResult>('hooks_test', { event, command })
}
