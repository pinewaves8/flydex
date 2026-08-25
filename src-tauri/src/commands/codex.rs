use tauri::{AppHandle, command};

use crate::services::codex_manager::{CodexExecMode, CodexManager};

/// 执行一条 codex 命令（异步，非阻塞）
///
/// 调用后立即返回，codex 的输出通过 `codex-output` 事件流式推送，
/// 结束时通过 `codex-done` 事件通知。
///
/// # Arguments
/// * `command` - 用户指令文本
/// * `workdir` - 工作目录（可选）
/// * `mode` - 执行模式："exec"（首轮）或 "resume"（恢复会话）
/// * `thread_id` - 恢复指定会话（可选，resume 模式下不传则恢复最近一次）
#[command]
pub async fn run_codex(
    app: AppHandle,
    command: String,
    workdir: Option<String>,
    mode: Option<String>,
    thread_id: Option<String>,
) -> Result<(), String> {
    let exec_mode = match mode.as_deref() {
        Some("resume") => CodexExecMode::Resume,
        _ => CodexExecMode::Exec,
    };

    tokio::task::spawn_blocking(move || {
        CodexManager::run_command(app, command, workdir, exec_mode, thread_id)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}
