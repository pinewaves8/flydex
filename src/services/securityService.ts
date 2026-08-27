import { invoke } from '@tauri-apps/api/core'

import type { ApprovalPolicy, SandboxMode, SecurityConfig } from '@/types/security'

/**
 * 安全配置 Service（沙箱 + 审批策略 + 历史）
 */
export const securityService = {
  /** 读取当前安全配置 */
  async get(): Promise<SecurityConfig> {
    return invoke<SecurityConfig>('get_security')
  },

  /** 设置沙箱模式 */
  async setSandboxMode(mode: SandboxMode): Promise<SecurityConfig> {
    return invoke<SecurityConfig>('set_sandbox_mode', { mode })
  },

  /** 设置审批策略 */
  async setApprovalPolicy(policy: ApprovalPolicy): Promise<SecurityConfig> {
    return invoke<SecurityConfig>('set_approval_policy', { policy })
  },

  /** 记录一条审批历史 */
  async recordApproval(command: string, approved: boolean, runId: string): Promise<SecurityConfig> {
    return invoke<SecurityConfig>('record_approval', { command, approved, runId })
  },

  /** 清空审批历史 */
  async clearHistory(): Promise<SecurityConfig> {
    return invoke<SecurityConfig>('clear_approval_history')
  },
}
