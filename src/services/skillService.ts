import { invoke } from '@tauri-apps/api/core'

import type { SkillDefinition } from '@/types/skill'

export interface ValidationReport {
  ok: boolean
  errors: string[]
  warnings: string[]
}

/** 扫描项目目录下的技能 */
export async function listProjectSkills(baseDir: string): Promise<SkillDefinition[]> {
  return invoke<SkillDefinition[]>('skill_list', { baseDir })
}

/** 读取 SKILL.md 全文 */
export async function readSkillContent(path: string): Promise<string> {
  return invoke<string>('skill_read', { path })
}

/** 校验 SKILL.md 内容（校验门禁，不入库） */
export async function validateSkillContent(content: string): Promise<ValidationReport> {
  return invoke<ValidationReport>('skill_validate', { content })
}

/** 创建/更新 skill（先校验；已存在同名 skill 时备份旧版可回滚） */
export async function createSkill(
  baseDir: string,
  name: string,
  content: string,
): Promise<ValidationReport> {
  return invoke<ValidationReport>('skill_create', { baseDir, name, content })
}

/** 删除 skill（先备份到 logs/skill-trash/ 可回滚，返回备份路径） */
export async function deleteSkill(baseDir: string, name: string): Promise<string> {
  return invoke<string>('skill_delete', { baseDir, name })
}

/** 7.4.1 导入结果 */
export interface ImportResult {
  target: string
  report: ValidationReport
}

/** 7.4.1 导入/导出 skill（跨目录复制，方向通用：from→to 复制 .codex/skills/<name> 含 assets） */
export async function importSkill(
  fromDir: string,
  name: string,
  toDir: string,
): Promise<ImportResult> {
  return invoke<ImportResult>('skill_import', { fromDir, name, toDir })
}
