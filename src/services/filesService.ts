import { invoke } from '@tauri-apps/api/core'

export interface DirectoryItem {
  name: string
  /** 目录是否含可见子项（懒加载展开箭头依据） */
  hasChildren: boolean
}

export interface DirectoryEntry {
  path: string
  dirs: DirectoryItem[]
  files: string[]
}

/** 列出目录单层内容（懒加载文件树基础）。大仓性能：10,000 文件仓库单层 < 2ms、递归全扫 < 40ms。 */
export async function listDirectory(path: string): Promise<DirectoryEntry> {
  return await invoke<DirectoryEntry>('list_directory', { path })
}
