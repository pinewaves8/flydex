use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

use tauri::{AppHandle, Emitter};

use crate::types::codex::CodexEvent;

/// Codex CLI 子进程管理器
///
/// 通过 `codex exec` 命令执行用户指令，
/// 流式读取 stdout/stderr 并通过 Tauri 事件推送到前端。
pub struct CodexManager;

impl CodexManager {
    /// 执行一条 codex exec 命令
    ///
    /// # Arguments
    /// * `app` - Tauri 应用句柄，用于发送事件
    /// * `command` - 用户指令文本
    /// * `workdir` - 工作目录（可选，默认为当前目录）
    pub fn run_command(
        app: AppHandle,
        command: String,
        workdir: Option<String>,
    ) -> Result<(), String> {
        let mut cmd = Command::new("codex");
        cmd.arg("exec").arg(&command);

        if let Some(dir) = &workdir {
            cmd.current_dir(dir);
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn codex process: {}", e))?;

        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture codex stdout")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Failed to capture codex stderr")?;

        // 线程：读取 stdout 并推送事件
        let app_stdout = app.clone();
        let stdout_thread = std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = app_stdout.emit(
                        "codex://output",
                        CodexEvent::Output { text: line },
                    );
                }
            }
        });

        // 线程：读取 stderr 并推送事件
        let app_stderr = app.clone();
        let stderr_thread = std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = app_stderr.emit(
                        "codex://output",
                        CodexEvent::Error { message: line },
                    );
                }
            }
        });

        // 等待子进程结束
        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for codex process: {}", e))?;
        let exit_code = status.code().unwrap_or(-1);

        // 等待读取线程结束
        let _ = stdout_thread.join();
        let _ = stderr_thread.join();

        // 推送完成事件
        app.emit("codex://done", CodexEvent::Done { exit_code })
            .map_err(|e| format!("Failed to emit codex done event: {}", e))?;

        Ok(())
    }
}
