use tauri::{AppHandle, command};

use crate::services::codex_manager::CodexManager;

/// 执行一条 codex exec 命令（异步，非阻塞）
///
/// 调用后立即返回，codex 的输出通过 `codex://output` 事件流式推送，
/// 结束时通过 `codex://done` 事件通知。
#[command]
pub async fn run_codex(
    app: AppHandle,
    command: String,
    workdir: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || CodexManager::run_command(app, command, workdir))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}
