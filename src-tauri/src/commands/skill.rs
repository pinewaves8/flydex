use crate::services::skill;
use crate::services::skill::SkillDefinition;
use crate::services::skill::ValidationReport;

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

/// 校验 SKILL.md 内容（校验门禁，不入库）
#[tauri::command]
pub fn skill_validate(content: String) -> ValidationReport {
    skill::validate_skill_content(&content)
}

/// 创建/更新 skill（先校验；已存在同名 skill 时备份旧版到 logs/skill-trash/ 可回滚）
#[tauri::command]
pub fn skill_create(
    base_dir: String,
    name: String,
    content: String,
) -> Result<ValidationReport, String> {
    skill::create_skill(&base_dir, &name, &content)
}

/// 删除 skill（先备份到 logs/skill-trash/ 可回滚，返回备份路径）
#[tauri::command]
pub fn skill_delete(base_dir: String, name: String) -> Result<String, String> {
    skill::delete_skill(&base_dir, &name)
}
