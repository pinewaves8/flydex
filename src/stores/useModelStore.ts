import { create } from 'zustand'

import { modelService } from '../services/modelService'
import type { ModelConfigFile } from '../types/model'

interface ModelState {
  config: ModelConfigFile | null
  loading: boolean
  error: string | null
  load: () => Promise<void>
  setCurrentModel: (modelId: string) => Promise<void>
  setReasoningEffort: (effort: string) => Promise<void>
  applyConfig: (cfg: ModelConfigFile) => void
}

export const useModelStore = create<ModelState>((set) => ({
  config: null,
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null })
    try {
      const cfg = await modelService.getModels()
      set({ config: cfg, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  async setCurrentModel(modelId) {
    const cfg = await modelService.setCurrentModel(modelId)
    set({ config: cfg, error: null })
  },

  async setReasoningEffort(effort) {
    const cfg = await modelService.setReasoningEffort(effort)
    set({ config: cfg, error: null })
  },

  applyConfig(cfg) {
    set({ config: cfg, error: null })
  },
}))
