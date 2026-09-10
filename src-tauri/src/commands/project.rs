use tauri::AppHandle;

use crate::models::project::Project;
use crate::services::project_map::ProjectMap;
use crate::services::storage::Storage;
use crate::services::thread_cascade::{ProjectDeleteOutcome, ThreadCascade};

/// 列出所有项目
#[tauri::command]
pub fn list_projects() -> Vec<Project> {
    Storage::list_projects()
}

/// 创建项目
#[tauri::command]
pub fn create_project(name: String, path: String) -> Result<Project, String> {
    let id = format!("proj_{}", uuid_simple());
    let now = now_ms();
    let project = Project {
        id: id.clone(),
        name,
        path,
        platform: current_platform(),
        created_at: now,
        updated_at: now,
    };
    Storage::upsert_project(project.clone()).map_err(|e| e.to_string())?;
    Ok(project)
}

/// 更新项目
#[tauri::command]
pub fn update_project(project: Project) -> Result<(), String> {
    let mut p = project;
    p.updated_at = now_ms();
    Storage::upsert_project(p).map_err(|e| e.to_string())
}

/// 删除项目(**连带删除该项目下的全部会话**)
///
/// 顺序:先删 codex 侧的会话与 project,再清理 Flydex 的本地条目。
/// 会话有任何删不掉 → **不删 codex project、也不删本地条目** —— 保留可重试的
/// 状态,而不是留下一堆无归属孤儿(第三原则:失败必须可见)。
#[tauri::command]
pub fn delete_project(app: AppHandle, project_id: String) -> Result<ProjectDeleteOutcome, String> {
    let mut outcome = ProjectDeleteOutcome::default();
    if let Some(codex_pid) = ProjectMap::codex_project_id_for(&project_id) {
        let r = ThreadCascade::delete_project(&app, &codex_pid)?;
        outcome.deleted_threads = r.deleted_threads;
        if !r.project_deleted {
            outcome.failures = r.failures;
            return Ok(outcome);
        }
        outcome.project_deleted = true;
        // 映射表也要清:否则「删项目 → 重建同目录」会命中已删除的 project id
        ProjectMap::remove_mapping(&codex_pid)?;
    }
    Storage::delete_project(&project_id).map_err(|e| e.to_string())?;
    Ok(outcome)
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
    // 简单的唯一 ID：时间戳 + 随机数
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    // 简单的伪随机
    let mut x = nanos as u64;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    let rand: u64 = x;
    format!("{:x}{:x}", nanos, rand)
}

fn current_platform() -> String {
    if cfg!(windows) {
        "windows".to_string()
    } else if cfg!(target_os = "macos") {
        "macos".to_string()
    } else {
        "linux".to_string()
    }
}

// 保留 AppHandle 参数以保持一致性（未来可能用于事件推送）
#[allow(dead_code)]
fn _app_handle_placeholder(_app: AppHandle) {}
