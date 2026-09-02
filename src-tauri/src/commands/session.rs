use crate::models::session::{Session, SessionMeta, SessionSearchHit};
use crate::services::storage::Storage;

/// 列出会话元数据（仅未删除的）
///
/// 如果指定 project_id，只返回该项目下的会话；否则返回所有会话。
#[tauri::command]
pub fn list_sessions(project_id: Option<String>) -> Vec<SessionMeta> {
    Storage::list_sessions(project_id.as_deref())
}

/// 列出回收站中的会话（已软删除）
#[tauri::command]
pub fn list_trashed_sessions() -> Vec<SessionMeta> {
    Storage::list_trashed_sessions()
}

/// 加载会话详情
#[tauri::command]
pub fn load_session(session_id: String) -> Option<Session> {
    Storage::load_session(&session_id)
}

/// 创建会话
#[tauri::command]
pub fn create_session(
    project_id: String,
    title: String,
    workdir: String,
    model: Option<String>,
) -> Result<Session, String> {
    let id = format!("sess_{}", uuid_simple());
    let now = now_ms();
    let session = Session {
        id: id.clone(),
        project_id,
        title,
        workdir,
        thread_id: None,
        model,
        messages: Vec::new(),
        created_at: now,
        updated_at: now,
        deleted_at: None,
        forked_from: None,
    };
    Storage::save_session(&session).map_err(|e| e.to_string())?;
    Ok(session)
}

/// 保存会话（全量覆盖）
#[tauri::command]
pub fn save_session(session: Session) -> Result<(), String> {
    let mut s = session;
    s.updated_at = now_ms();
    Storage::save_session(&s).map_err(|e| e.to_string())
}

/// 硬删除会话（永久删除文件）
#[tauri::command]
pub fn delete_session(session_id: String) -> Result<(), String> {
    Storage::delete_session(&session_id).map_err(|e| e.to_string())
}

/// 重命名会话
#[tauri::command]
pub fn rename_session(session_id: String, title: String) -> Result<(), String> {
    let mut session = Storage::load_session(&session_id).ok_or("Session not found")?;
    session.title = title;
    session.updated_at = now_ms();
    Storage::save_session(&session).map_err(|e| e.to_string())
}

/// 把会话移到回收站（软删除）
#[tauri::command]
pub fn trash_session(session_id: String) -> Result<(), String> {
    Storage::trash_session(&session_id)
}

/// 从回收站恢复会话
#[tauri::command]
pub fn restore_session(session_id: String) -> Result<(), String> {
    Storage::restore_session(&session_id)
}

/// 从指定消息索引 fork 一个新会话
#[tauri::command]
pub fn fork_session(session_id: String, message_index: usize) -> Result<Session, String> {
    Storage::fork_session(&session_id, message_index)
}

/// 全文搜索会话（title + 内容）
#[tauri::command]
pub fn search_sessions(
    query: String,
    project_id: Option<String>,
) -> Vec<SessionSearchHit> {
    Storage::search_sessions(&query, project_id.as_deref())
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

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let rand: u64 = unsafe {
        let mut x = nanos as u64;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    };
    format!("{:x}{:x}", nanos, rand)
}