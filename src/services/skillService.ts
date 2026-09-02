import { invoke } from '@tauri-apps/api/core'

import type { SkillDefinition } from '@/types/skill'

/** 扫描项目目录下的技能 */
export async function listProjectSkills(baseDir: string): Promise<SkillDefinition[]> {
  return invoke<SkillDefinition[]>('skill_list', { baseDir })
}

/** 读取 SKILL.md 全文 */
export async function readSkillContent(path: string): Promise<string> {
  return invoke<string>('skill_read', { path })
}
