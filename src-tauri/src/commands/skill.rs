use crate::services::skill;
use crate::services::skill::SkillDefinition;

/// 扫描项目目录下的技能列表
#[tauri::command]
pub fn skill_list(base_dir: String) -> Result<Vec<SkillDefinition>, String> {
    skill::scan_project_skills(&base_dir)
}

/// 读取 SKILL.md 全文
#[tauri::command]
pub fn skill_read(path: String) -> Result<String, String> {
    skill::read_skill_content(&path)
}