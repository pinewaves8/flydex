import { invoke } from '@tauri-apps/api/core'

import type { ModelConfig, ModelConfigFile, ProviderConfig } from '../types/model'

export const modelService = {
  getModels(): Promise<ModelConfigFile> {
    return invoke('get_models')
  },
  setCurrentModel(modelId: string): Promise<ModelConfigFile> {
    return invoke('set_current_model', { modelId })
  },
  setReasoningEffort(effort: string): Promise<ModelConfigFile> {
    return invoke('set_reasoning_effort', { effort })
  },
  upsertProvider(provider: ProviderConfig): Promise<ModelConfigFile> {
    return invoke('upsert_provider', { provider })
  },
  deleteProvider(providerId: string): Promise<ModelConfigFile> {
    return invoke('delete_provider', { providerId })
  },
  upsertModel(model: ModelConfig): Promise<ModelConfigFile> {
    return invoke('upsert_model', { model })
  },
  deleteModel(modelId: string): Promise<ModelConfigFile> {
    return invoke('delete_model', { modelId })
  },
  testConnection(providerId: string): Promise<string> {
    return invoke('test_model_connection', { providerId })
  },
  testModel(modelId: string): Promise<string> {
    return invoke('test_model', { modelId })
  },
}
