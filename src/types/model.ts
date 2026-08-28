/** 模型配置类型（对应 Rust 端 ModelConfigFile） */

export interface ProviderConfig {
  id: string
  name: string
  base_url: string
  api_key: string
}

export interface ModelConfig {
  id: string
  provider: string
  context_window?: number | null
}

export interface ModelConfigFile {
  providers: ProviderConfig[]
  models: ModelConfig[]
  current_model: string
  /** none / minimal / low / medium / high */
  reasoning_effort: string
}

export const REASONING_LEVELS = [
  { value: 'none', label: '不设置（模型默认）' },
  { value: 'minimal', label: 'Minimal 极简' },
  { value: 'low', label: 'Low 低' },
  { value: 'medium', label: 'Medium 中' },
  { value: 'high', label: 'High 高' },
] as const

export function reasoningLabel(v: string): string {
  return REASONING_LEVELS.find((r) => r.value === v)?.label ?? v
}
