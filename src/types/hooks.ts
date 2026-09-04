export interface Hook {
  event: string
  command: string
  note: string
}

export interface HooksConfig {
  hooks: Hook[]
}

export interface HookRunResult {
  exit: number | null
  stdout: string
  stderr: string
  skipped: boolean
  reason: string
  ms: number
}
