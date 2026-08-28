use crate::models::session::{Session, SessionMeta};
use crate::services::storage::Storage;

/// 列出会话元数据
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

/// 删除会话
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
