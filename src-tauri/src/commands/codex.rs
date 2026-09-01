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
/// * `run_id` - 本次运行的唯一标识（审批/停止用，前端生成）
/// * `model` - 会话级模型覆盖（可选，None 时用全局默认）
#[command]
pub async fn run_codex(
    app: AppHandle,
    command: String,
    workdir: Option<String>,
    mode: Option<String>,
    thread_id: Option<String>,
    run_id: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    let exec_mode = match mode.as_deref() {
        Some("resume") => CodexExecMode::Resume,
        Some("plan") => CodexExecMode::Plan,
        _ => CodexExecMode::Exec,
    };
    let rid = run_id.unwrap_or_else(|| {
        format!("run-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0))
    });

    tokio::task::spawn_blocking(move || {
        CodexManager::run_command(app, command, workdir, exec_mode, thread_id, rid, model)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 审批响应：向运行中的 codex 写入 y/n，并记录审批历史
#[command]
pub fn approve_codex(
    run_id: String,
    approve: bool,
    command: Option<String>,
) -> Result<(), String> {
    // 写入审批响应
    CodexManager::approve(&run_id, approve)?;
    // 记录审批历史（command 由前端从 approval_request item 传入）
    if let Some(cmd) = command {
        let record = crate::services::security::ApprovalRecord {
            id: format!(
                "ap-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            ),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
            command: cmd,
            approved: approve,
            run_id,
        };
        let _ = crate::services::security::SecurityService::add_history(record);
    }
    Ok(())
}

/// 停止运行中的 codex
#[command]
pub fn stop_codex(run_id: String) -> Result<(), String> {
    CodexManager::stop(&run_id)
}
