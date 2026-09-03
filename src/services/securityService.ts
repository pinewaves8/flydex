import { invoke } from '@tauri-apps/api/core'

import type {
  ApprovalPolicy,
  PermissionRules,
  RuleAction,
  SandboxMode,
  SecurityConfig,
} from '@/types/security'

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

  /** 设置 git 自动快照开关 */
  async setAutoCheckpoint(enabled: boolean): Promise<SecurityConfig> {
    return invoke<SecurityConfig>('set_auto_checkpoint', { enabled })
  },

  /** 记录一条审批历史 */
  async recordApproval(command: string, approved: boolean, runId: string): Promise<SecurityConfig> {
    return invoke<SecurityConfig>('record_approval', { command, approved, runId })
  },

  /** 清空审批历史 */
  async clearHistory(): Promise<SecurityConfig> {
    return invoke<SecurityConfig>('clear_approval_history')
  },

  /** 读取全部权限规则 */
  async listRules(): Promise<PermissionRules> {
    return invoke<PermissionRules>('list_permission_rules')
  },

  /** 新增权限规则（deny/allow） */
  async addRule(pattern: string, action: RuleAction, note?: string): Promise<PermissionRules> {
    return invoke<PermissionRules>('add_permission_rule', { pattern, action, note: note ?? '' })
  },

  /** 删除权限规则（按 index） */
  async removeRule(index: number): Promise<PermissionRules> {
    return invoke<PermissionRules>('remove_permission_rule', { index })
  },

  /** 清空全部权限规则 */
  async clearRules(): Promise<PermissionRules> {
    return invoke<PermissionRules>('clear_permission_rules')
  },
}
