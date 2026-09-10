//! 会话(thread)相关的 Tauri 命令
//!
//! 会话的权威数据源是 codex —— 这里只做参数转换与调用,不含业务逻辑
//! (归属/级联/幂等等在 `services::project_map` 与 `services::thread_client`)。

use std::collections::HashMap;

use tauri::AppHandle;

use crate::models::thread::{ThreadOccurrence, ThreadRow, ThreadSearchHit};
use crate::services::project_map::{ProjectEntry, ProjectMap, ProjectSyncOutcome};
use crate::services::thread_cascade::{CascadeOutcome, ThreadCascade};
use crate::services::thread_client::ThreadClient;
use crate::services::thread_settings::{ThreadSettings, ThreadSettingsService};

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

/// 把会话归入某个 codex project(传 `null` 清除归属)
///
/// 注意时机:**必须在本轮结束后**调用。`thread/start` 刚返回时该线程还没有落盘,
/// 此时 `thread/metadata/update` 会被随后开始的 turn 覆盖掉(已实测:同样调用
/// 放在本轮之后就能存住)。`thread/start` 的参数里也没有 projectId ——
/// 与 `thread/fork` 是同一处协议缺口。
#[tauri::command]
pub fn set_thread_project(
    app: AppHandle,
    thread_id: String,
    project_id: Option<String>,
) -> Result<(), String> {
    ThreadClient::set_project(&app, &thread_id, project_id.as_deref())
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

/// **永久删除,不可逆**
///
/// 连同由它 fork 出的全部后代一起删(叶子优先)。
///
/// codex 自己**不级联**也**不拒绝** —— 只删父会留下孤儿分支,所以级联由这里做。
/// 删不掉的逐条回传,由 UI 展示(第三原则)。
#[tauri::command]
pub fn delete_thread(app: AppHandle, thread_id: String) -> Result<CascadeOutcome, String> {
    ThreadCascade::delete_threads(&app, &[thread_id])
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

/// 读会话级 UI 偏好(目前只有模型覆盖)
///
/// 这些是 Flydex 的展示偏好,codex 的 Thread 里没有对应字段 ——
/// 见 `services::thread_settings` 的模块说明。
#[tauri::command]
pub fn get_thread_settings(thread_id: String) -> ThreadSettings {
    ThreadSettingsService::get(&thread_id)
}

/// 设置会话级模型覆盖。`model = None` 表示跟随全局默认。
#[tauri::command]
pub fn set_thread_model(thread_id: String, model: Option<String>) -> Result<(), String> {
    ThreadSettingsService::set_model(&thread_id, model)
}

/// 分叉结果
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkOutcome {
    /// 新会话 id。**即使归属写入失败也要返回** —— 否则用户找不到刚分叉出来的会话
    pub thread_id: String,
    /// 归属写入失败的原因(为 None 表示一切正常)
    pub warning: Option<String>,
}

/// 从某一轮之后分叉出新会话
///
/// `ThreadForkParams` 没有 projectId(与 `thread/start` 同一处协议缺口),所以要补一次
/// 归属写入。分叉本身成功、归属失败时**不返回错误**:新会话已经建出来了,把 id 丢掉
/// 比归属缺失更糟 —— 改为回传 warning 由 UI 展示。
#[tauri::command]
pub fn fork_thread(
    app: AppHandle,
    thread_id: String,
    last_turn_id: String,
    cwd: Option<String>,
    project_id: Option<String>,
    model: Option<String>,
) -> Result<ForkOutcome, String> {
    // 与每轮 resume 用同一份 config(模型 + 供应商),否则分叉出的会话会退回全局配置
    let config = crate::services::model::ModelService::thread_config(model.as_deref())
        .map(serde_json::Value::Object);

    let new_id = ThreadClient::fork(
        &app,
        &thread_id,
        Some(&last_turn_id),
        None,
        cwd.as_deref(),
        config,
    )?;

    let warning = match project_id.as_deref().filter(|p| !p.is_empty()) {
        None => None,
        Some(pid) => ThreadClient::set_project(&app, &new_id, Some(pid))
            .err()
            .map(|e| format!("新会话已创建,但未能归入当前项目:{e}")),
    };

    Ok(ForkOutcome {
        thread_id: new_id,
        warning,
    })
}
