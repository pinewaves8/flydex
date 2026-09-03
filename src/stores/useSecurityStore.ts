import { create } from 'zustand'

import { securityService } from '@/services/securityService'
import type {
  ApprovalPolicy,
  PermissionRules,
  RuleAction,
  SandboxMode,
  SecurityConfig,
} from '@/types/security'

interface SecurityState {
  config: SecurityConfig | null
  rules: PermissionRules | null
  load: () => Promise<void>
  loadRules: () => Promise<void>
  setSandboxMode: (mode: SandboxMode) => Promise<boolean>
  setApprovalPolicy: (policy: ApprovalPolicy) => Promise<boolean>
  setAutoCheckpoint: (enabled: boolean) => Promise<boolean>
  addRule: (pattern: string, action: RuleAction, note?: string) => Promise<boolean>
  removeRule: (index: number) => Promise<boolean>
  clearRules: () => Promise<void>
  clearHistory: () => Promise<void>
}

/**
 * 安全配置 Store
 *
 * 管理沙箱模式、审批策略与审批历史，所有修改都会持久化到
 * `~/.flydex/security.json`，并在下一次 codex 运行时生效。
 */
export const useSecurityStore = create<SecurityState>((set) => ({
  config: null,
  rules: null,

  load: async () => {
    try {
      const config = await securityService.get()
      set({ config })
    } catch (err) {
      console.error('[security] load failed', err)
    }
  },

  setSandboxMode: async (mode) => {
    try {
      const config = await securityService.setSandboxMode(mode)
      set({ config })
      return true
    } catch (err) {
      console.error('[security] setSandboxMode failed', err)
      return false
    }
  },

  setApprovalPolicy: async (policy) => {
    try {
      const config = await securityService.setApprovalPolicy(policy)
      set({ config })
      return true
    } catch (err) {
      console.error('[security] setApprovalPolicy failed', err)
      return false
    }
  },

  setAutoCheckpoint: async (enabled) => {
    try {
      const config = await securityService.setAutoCheckpoint(enabled)
      set({ config })
      return true
    } catch (err) {
      console.error('[security] setAutoCheckpoint failed', err)
      return false
    }
  },

  loadRules: async () => {
    try {
      set({ rules: await securityService.listRules() })
    } catch (err) {
      console.error('[security] loadRules failed', err)
    }
  },

  addRule: async (pattern, action, note) => {
    try {
      set({ rules: await securityService.addRule(pattern, action, note) })
      return true
    } catch (err) {
      console.error('[security] addRule failed', err)
      return false
    }
  },

  removeRule: async (index) => {
    try {
      set({ rules: await securityService.removeRule(index) })
      return true
    } catch (err) {
      console.error('[security] removeRule failed', err)
      return false
    }
  },

  clearRules: async () => {
    try {
      set({ rules: await securityService.clearRules() })
    } catch (err) {
      console.error('[security] clearRules failed', err)
    }
  },

  clearHistory: async () => {
    try {
      const config = await securityService.clearHistory()
      set({ config })
    } catch (err) {
      console.error('[security] clearHistory failed', err)
    }
  },
}))
