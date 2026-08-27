import { create } from 'zustand'

import { securityService } from '@/services/securityService'
import type { ApprovalPolicy, SandboxMode, SecurityConfig } from '@/types/security'

interface SecurityState {
  config: SecurityConfig | null
  load: () => Promise<void>
  setSandboxMode: (mode: SandboxMode) => Promise<boolean>
  setApprovalPolicy: (policy: ApprovalPolicy) => Promise<boolean>
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

  clearHistory: async () => {
    try {
      const config = await securityService.clearHistory()
      set({ config })
    } catch (err) {
      console.error('[security] clearHistory failed', err)
    }
  },
}))
