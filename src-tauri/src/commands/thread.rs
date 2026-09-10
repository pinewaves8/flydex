//! 会话(thread)相关的 Tauri 命令
//!
//! 会话的权威数据源是 codex —— 这里只做参数转换与调用,不含业务逻辑
//! (归属/级联/幂等等在 `services::project_map` 与 `services::thread_client`)。

use std::collections::HashMap;

use tauri::AppHandle;

use crate::models::thread::{ThreadOccurrence, ThreadRow, ThreadSearchHit};
use crate::services::project_map::{ProjectEntry, ProjectMap, ProjectSyncOutcome};
use crate::services::thread_client::ThreadClient;

/// 把 Flydex 项目同步到 codex `project/*`,并回填已有线程的归属。幂等,可在每次启动时调用。
#[tauri::command]
pub fn sync_projects(app: AppHandle) -> Result<ProjectSyncOutcome, String> {
    ProjectMap::sync(&app)
}

/// 读取本地映射缓存(codex 不可用时前端仍能显示项目归属)
#[tauri::command]
pub fn project_map_entries() -> HashMap<String, ProjectEntry> {
    ProjectMap::entries()
}

/// 列出会话(thread)。`archived = true` 即回收站。
#[tauri::command]
pub fn list_threads(
    app: AppHandle,
    archived: Option<bool>,
    project_id: Option<String>,
) -> Result<Vec<ThreadRow>, String> {
    ThreadClient::list_all(&app, archived.unwrap_or(false), project_id.as_deref())
}

/// 读单个会话的元数据(deep-link 时用;列表里已有的话无需调)
#[tauri::command]
pub fn read_thread(app: AppHandle, thread_id: String) -> Result<Option<ThreadRow>, String> {
    ThreadClient::read_meta(&app, &thread_id)
}

/// 打开会话:取最新一页轮次。返回 `(turns, backwardsCursor)`
///
/// turns 原样透传(前端 `threadItems.ts` 负责映射成消息);
/// `backwardsCursor` 用于往更早的历史翻页。
#[tauri::command]
pub fn load_thread_turns(
    app: AppHandle,
    thread_id: String,
    limit: Option<u32>,
) -> Result<(Vec<serde_json::Value>, Option<String>), String> {
    ThreadClient::recent_turns(&app, &thread_id, limit.unwrap_or(20))
}

/// 往更早的历史翻一页(用上一页返回的 `backwardsCursor`)
#[tauri::command]
pub fn load_earlier_turns(
    app: AppHandle,
    thread_id: String,
    cursor: String,
    limit: Option<u32>,
) -> Result<(Vec<serde_json::Value>, Option<String>), String> {
    ThreadClient::earlier_turns(&app, &thread_id, &cursor, limit.unwrap_or(20))
}

/// 重命名会话(codex `thread/name/set`)。**已归档的会话不能改名**(codex 约束)。
#[tauri::command]
pub fn rename_thread(app: AppHandle, thread_id: String, name: String) -> Result<(), String> {
    ThreadClient::set_name(&app, &thread_id, &name)
}

/// 移入回收站(可逆)
#[tauri::command]
pub fn archive_thread(app: AppHandle, thread_id: String) -> Result<(), String> {
    ThreadClient::archive(&app, &thread_id)
}

/// 从回收站恢复
#[tauri::command]
pub fn unarchive_thread(app: AppHandle, thread_id: String) -> Result<(), String> {
    ThreadClient::unarchive(&app, &thread_id)
}

/// 一级搜索:命中的会话 + 片段(粒度是会话,非消息)
#[tauri::command]
pub fn search_threads(
    app: AppHandle,
    query: String,
    archived: Option<bool>,
    limit: Option<u32>,
) -> Result<Vec<ThreadSearchHit>, String> {
    ThreadClient::search(&app, &query, archived.unwrap_or(false), limit.unwrap_or(50))
}

/// 二级搜索:会话内逐条命中位置,用于跳转定位
#[tauri::command]
pub fn search_thread_occurrences(
    app: AppHandle,
    thread_id: String,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<ThreadOccurrence>, String> {
    ThreadClient::search_occurrences(&app, &thread_id, &query, limit.unwrap_or(50))
}
