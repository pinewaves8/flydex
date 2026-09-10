use std::io::Write;
use std::path::PathBuf;

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
/// * `images` - 图像附件路径列表（可选，save_attachment_image 落盘后的相对路径）
#[command]
pub async fn run_codex(
    app: AppHandle,
    command: String,
    workdir: Option<String>,
    mode: Option<String>,
    thread_id: Option<String>,
    run_id: Option<String>,
    model: Option<String>,
    images: Option<Vec<String>>,
    sandbox: Option<String>,
    project_id: Option<String>,
) -> Result<(), String> {
    let exec_mode = match mode.as_deref() {
        Some("resume") => CodexExecMode::Resume,
        Some("plan") => CodexExecMode::Plan,
        Some("review") => CodexExecMode::Review,
        _ => CodexExecMode::Exec,
    };
    let rid = run_id.unwrap_or_else(|| {
        format!("run-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0))
    });

    tokio::task::spawn_blocking(move || {
        CodexManager::run_command(
            app,
            command,
            workdir,
            exec_mode,
            thread_id,
            rid,
            crate::services::codex_manager::RunOverrides {
                model,
                images,
                sandbox,
                project_id,
            },
        )
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 保存图像附件到工作目录的 .flydex-attachments/ 目录，返回相对路径
///
/// 前端把图片（File 对象）读成 base64 data URL 传入，这里解码后写入
/// `<workdir>/.flydex-attachments/<name>`。返回**相对路径**（如
/// `./.flydex-attachments/xxx.png`），供 codex 的 `-i/--image` 使用——
/// 相对路径可规避 Windows 下 cmd /c 对含空格/盘符绝对路径的引号解析问题
/// （codex 子进程 cwd 为 workdir，相对路径可直接解析）。
#[command]
pub fn save_attachment_image(
    workdir: String,
    file_name: String,
    data: String,
) -> Result<String, String> {
    use base64::Engine;

    // 兼容 data URL（data:image/png;base64,xxx）与裸 base64 两种传入
    let b64 = data
        .split_once("base64,")
        .map(|(_, rest)| rest)
        .unwrap_or(&data);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("图片 base64 解码失败: {e}"))?;

    // 目录固定为 .flydex-attachments；文件名只取 basename，防路径穿越
    let safe_name = PathBuf::from(file_name)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "attachment.png".to_string());

    let dir = PathBuf::from(&workdir).join(".flydex-attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建附件目录失败: {e}"))?;
    let dest = dir.join(&safe_name);
    let mut f = std::fs::File::create(&dest).map_err(|e| format!("写入附件失败: {e}"))?;
    f.write_all(&bytes).map_err(|e| format!("写入附件失败: {e}"))?;

    Ok(format!("./.flydex-attachments/{}", safe_name))
}

/// 审批响应：向运行中的 codex 写入 y/n，并记录审批历史
#[command]
pub fn approve_codex(
    run_id: String,
    approve: bool,
    command: Option<String>,
    approval_id: Option<String>,
) -> Result<(), String> {
    // 写入审批响应（approval_id 定位挂起的 ServerRequest，ap-{server_id}）
    CodexManager::approve(&run_id, approval_id.as_deref().unwrap_or(""), approve)?;
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
