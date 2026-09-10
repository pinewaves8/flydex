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
pub fn search_sessions(query: String, project_id: Option<String>) -> Vec<SessionSearchHit> {
    Storage::search_sessions(&query, project_id.as_deref())
}

/// 全文搜索消息内容(跨会话,带片段预览 —— 对齐 Claude Code Ctrl+R)
#[derive(Debug, serde::Serialize)]
pub struct MessageSearchHit {
    pub session_id: String,
    pub session_title: String,
    pub project_id: Option<String>,
    pub message_id: String,
    pub message_kind: String,
    pub snippet: String, // 匹配片段前后各 30 字
    pub timestamp: i64,
}

#[tauri::command]
pub fn search_messages(
    query: String,
    project_id: Option<String>,
    limit: Option<usize>,
) -> Vec<MessageSearchHit> {
    use crate::services::storage::Storage;
    let sessions = Storage::list_sessions(project_id.as_deref());
    let mut hits: Vec<MessageSearchHit> = Vec::new();
    let q = query.to_lowercase();
    let max = limit.unwrap_or(50);

    for meta in &sessions {
        if let Some(session) = Storage::load_session(&meta.id) {
            // session.messages 是 Vec<serde_json::Value>,递归找所有有 id + content 的对象
            let mut found_in_session: Vec<(String, String, i64)> = Vec::new();
            for msg_value in &session.messages {
                collect_message_matches(msg_value, &mut found_in_session);
            }
            for (msg_id, content, timestamp) in found_in_session {
                if content.is_empty() {
                    continue;
                }
                let lower = content.to_lowercase();
                if let Some(pos) = lower.find(&q) {
                    // 找最近的合法 char 边界(避免切到 UTF-8 多字节字符中间)
                    let mut start = pos.saturating_sub(30);
                    while start > 0 && !content.is_char_boundary(start) {
                        start -= 1;
                    }
                    let mut end = (pos + q.len() + 30).min(content.len());
                    while end < content.len() && !content.is_char_boundary(end) {
                        end += 1;
                    }
                    let mut snippet = String::new();
                    if start > 0 {
                        snippet.push_str("…");
                    }
                    snippet.push_str(&content[start..end]);
                    if end < content.len() {
                        snippet.push_str("…");
                    }
                    hits.push(MessageSearchHit {
                        session_id: meta.id.clone(),
                        session_title: meta.title.clone(),
                        project_id: Some(meta.project_id.clone()),
                        message_id: msg_id,
                        message_kind: "agent".into(),
                        snippet,
                        timestamp,
                    });
                    if hits.len() >= max {
                        return hits;
                    }
                }
            }
        }
    }
    hits
}

/// 迭代扫描 Value 树(避免递归栈溢出),提取所有有 id + content 的对象
/// 用显式栈模拟 DFS,大型 session 也能稳定处理
fn collect_message_matches(root: &serde_json::Value, out: &mut Vec<(String, String, i64)>) {
    let mut stack: Vec<&serde_json::Value> = vec![root];
    // 防止极端情况下无限循环(虽然 Value 是 DAG-free)
    let max_nodes = 100_000usize;
    let mut visited = 0usize;

    while let Some(value) = stack.pop() {
        if visited >= max_nodes {
            break;
        }
        visited += 1;

        match value {
            serde_json::Value::Object(map) => {
                let id = map
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let content = map
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let timestamp = map.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);
                if !id.is_empty() && !content.is_empty() {
                    // 限制 content 长度,防止巨型消息撑爆 out vector
                    // 注意:UTF-8 多字节字符不能切到中间,找到最近的 char 边界
                    let truncated = if content.len() > 100_000 {
                        let mut cut = 100_000;
                        while cut > 0 && !content.is_char_boundary(cut) {
                            cut -= 1;
                        }
                        format!("{}…[truncated]", &content[..cut])
                    } else {
                        content
                    };
                    out.push((id, truncated, timestamp));
                }
                // 子节点入栈
                for v in map.values() {
                    if v.is_object() || v.is_array() {
                        stack.push(v);
                    }
                }
            }
            serde_json::Value::Array(arr) => {
                for v in arr {
                    stack.push(v);
                }
            }
            _ => {}
        }

        // 早退:已收集到足够多就停止
        if out.len() >= 500 {
            break;
        }
    }
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
    let mut x = nanos as u64;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    let rand: u64 = x;
    format!("{:x}{:x}", nanos, rand)
}
