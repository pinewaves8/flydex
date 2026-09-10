//! 项目初始化 Tauri commands(对齐 Claude Code `/init`)
//!
//! 暴露 init_scan + init_write_file 给前端
//! - init_scan: 扫描工作目录返回 InitReport(情况 A/B/C/D 分类)
//! - init_write_file: 安全写入项目子路径(防止 ../ 越界)

use crate::services::init_scanner::{InitReport, InitScanner};
use crate::services::init_state::{InitStateData, InitStateService, InitStep};
use crate::services::init_validator::{validate_agents_md, ValidationReport};
use crate::services::init_writer::{InitWriter, WriteResult};

/// 扫描项目根目录,返回 InitReport(规范文件 / 需求 / 技术文档 / 项目骨架 检测)
#[tauri::command]
pub fn init_scan(workdir: String) -> Result<InitReport, String> {
    InitScanner::scan(&workdir)
}

/// 安全写入项目文件
///
/// `path` 必须为相对路径(如 `requirements.md` / `docs/tech-spec.md`)
/// `overwrite` 为 false 时,如文件已存在会报错(防止误覆盖)
#[tauri::command]
pub fn init_write_file(
    workdir: String,
    path: String,
    content: String,
    overwrite: bool,
) -> Result<WriteResult, String> {
    InitWriter::write_file(&workdir, &path, &content, overwrite)
}

/// 获取项目 init 状态(从 `<workdir>/.flydex/init-state.json`)
/// 用于启动时检测 init 是否在进行中,提示用户继续 / 取消
#[tauri::command]
pub fn init_get_state(workdir: String) -> Option<InitStateData> {
    InitStateService::get(&workdir)
}

/// 设置 init 流程状态(写入 .flydex/init-state.json)
/// step: idle | scanned | collecting-requirements | collecting-tech-spec | ready-to-generate | done
#[tauri::command]
pub fn init_set_state(
    workdir: String,
    scenario: String,
    step: String,
) -> Result<InitStateData, String> {
    let parsed = match step.as_str() {
        "idle" => InitStep::Idle,
        "scanned" => InitStep::Scanned,
        "collecting-requirements" => InitStep::CollectingRequirements,
        "collecting-tech-spec" => InitStep::CollectingTechSpec,
        "ready-to-generate" => InitStep::ReadyToGenerate,
        "done" => InitStep::Done,
        _ => return Err(format!("未知 init step: {}", step)),
    };
    InitStateService::set(&workdir, &scenario, parsed)
}

/// 清除 init 状态(init 完成或用户取消时调用)
#[tauri::command]
pub fn init_clear_state(workdir: String) {
    InitStateService::clear(&workdir)
}

/// 记录 init 过程中写入的文件路径(用于恢复时跳过重复)
#[tauri::command]
pub fn init_mark_written(workdir: String, path: String) -> Result<(), String> {
    InitStateService::append_written_file(&workdir, &path)
}

/// 校验 AGENTS.md 是否包含必填字段(YAML frontmatter)
///
/// 返回 ValidationReport:包含 missing_fields(必填缺失)、warnings(空值警告)、suggestions(建议)
#[tauri::command]
pub fn init_validate_agents(path: String) -> Result<ValidationReport, String> {
    validate_agents_md(&path)
}
