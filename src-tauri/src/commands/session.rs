//! 旧会话(迁移前)的**只读**通道。
//!
//! 会话迁移到 codex 后,`~/.flydex/sessions/*.json` 只剩归档用途:
//! 没有 threadId 的老会话无法从 codex 侧读到,这里是它们的唯一入口。
//! 写入类命令(创建/保存/删除/回收站/fork/搜索)已随迁移删除。

use crate::models::session::{Session, SessionMeta};
use crate::services::storage::Storage;

/// 列出会话元数据（仅未删除的）
///
/// 如果指定 project_id，只返回该项目下的会话；否则返回所有会话。
#[tauri::command]
pub fn list_sessions(project_id: Option<String>) -> Vec<SessionMeta> {
    Storage::list_sessions(project_id.as_deref())
}

/// 加载会话详情
#[tauri::command]
pub fn load_session(session_id: String) -> Option<Session> {
    Storage::load_session(&session_id)
}

/// 导出会话（json 或 markdown 字符串）
#[tauri::command]
pub fn export_session(session_id: String, format: String) -> Result<String, String> {
    match format.as_str() {
        "json" => Storage::export_json(&session_id),
        "markdown" => Storage::export_markdown(&session_id),
        _ => Err(format!("Unknown export format: {}", format)),
    }
}

// ── 工具函数 ──

