import { invoke } from '@tauri-apps/api/core'

/**
 * 记忆系统 Service（6.1）
 *
 * 封装后端 memory 命令：
 * - load_memory：加载用户级 + 项目级 MEMORY.md
 * - append_project_memory / append_user_memory：追加沉淀记录
 * - write_project_memory / write_user_memory：覆盖写入（记忆管理面板编辑）
 */

export interface MemoryData {
  user: string
  project: string
  user_file: string
  project_file: string
}

export const memoryService = {
  /** 加载记忆（用户级 + 项目级） */
  async load(workdir?: string | null): Promise<MemoryData> {
    return invoke<MemoryData>('load_memory', { workdir: workdir ?? null })
  },

  /** 向项目记忆追加一条沉淀记录 */
  async appendProject(
    workdir: string,
    section: string,
    content: string,
    source?: string,
  ): Promise<void> {
    await invoke('append_project_memory', {
      workdir,
      section,
      content,
      source: source ?? null,
    })
  },

  /** 向用户记忆追加一条沉淀记录 */
  async appendUser(section: string, content: string, source?: string): Promise<void> {
    await invoke('append_user_memory', {
      section,
      content,
      source: source ?? null,
    })
  },

  /** 覆盖写入项目记忆 */
  async writeProject(workdir: string, content: string): Promise<void> {
    await invoke('write_project_memory', { workdir, content })
  },

  /** 覆盖写入用户记忆 */
  async writeUser(content: string): Promise<void> {
    await invoke('write_user_memory', { content })
  },

  /** 从会话文本提取可沉淀的记忆候选（调用当前模型） */
  async extract(sessionText: string): Promise<unknown> {
    return invoke<unknown>('extract_memory', { sessionText })
  },

  /** 把会话文本压缩成上下文快照摘要（调用当前模型） */
  async compactSummary(sessionText: string): Promise<string> {
    return invoke<string>('compact_summary', { sessionText })
  },
}
