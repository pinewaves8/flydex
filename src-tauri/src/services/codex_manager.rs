use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::types::codex::CodexEvent;
use crate::types::codex_json::CodexJsonEvent;

/// Codex 执行模式
#[derive(Debug, Clone, Copy)]
pub enum CodexExecMode {
    /// 首轮执行：codex exec --json
    Exec,
    /// 恢复会话：codex exec resume --last --json
    Resume,
}

/// Codex CLI 子进程管理器
///
/// 通过 `codex exec` 或 `codex exec resume` 执行用户指令，
/// 解析 JSONL 输出并通过 Tauri 事件推送到前端。
pub struct CodexManager;

impl CodexManager {
    /// 执行一条 codex 命令
    ///
    /// # Arguments
    /// * `app` - Tauri 应用句柄
    /// * `command` - 用户指令文本
    /// * `workdir` - 工作目录（可选）
    /// * `mode` - 执行模式（Exec 首轮 / Resume 恢复会话）
    /// * `thread_id` - 恢复指定会话（可选，Resume 模式下不传则恢复最近一次）
    pub fn run_command(
        app: AppHandle,
        command: String,
        workdir: Option<String>,
        mode: CodexExecMode,
        thread_id: Option<String>,
    ) -> Result<(), String> {
        // 构建命令参数
        let mut args: Vec<String> = vec!["exec".to_string()];

        match mode {
            CodexExecMode::Exec => {
                // codex exec --json <command>
            }
            CodexExecMode::Resume => {
                // codex exec resume [thread_id] --json <command>
                args.push("resume".to_string());
                if let Some(tid) = &thread_id {
                    args.push(tid.clone());
                } else {
                    args.push("--last".to_string());
                }
            }
        }

        args.push("--json".to_string());
        args.push(command.clone());

        // Windows 上通过 cmd /c 启动
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.arg("/c").arg("codex").args(&args);
            c
        } else {
            let mut c = Command::new("codex");
            c.args(&args);
            c
        };

        if let Some(dir) = &workdir {
            cmd.current_dir(dir);
        }

        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn codex process: {}", e))?;

        let pid = child.id();

        // 推送进程启动事件
        app.emit("codex-output", CodexEvent::Started { pid })
            .map_err(|e| format!("Failed to emit started event: {}", e))?;

        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture codex stdout")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Failed to capture codex stderr")?;

        // 线程：读取 stdout（JSONL）并推送结构化事件
        let app_stdout = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if line.trim().is_empty() {
                        continue;
                    }
                    match serde_json::from_str::<serde_json::Value>(&line) {
                        Ok(json) => {
                            let _ = app_stdout.emit("codex-output", CodexEvent::Json(json));
                        }
                        Err(_) => {
                            let _ = app_stdout.emit(
                                "codex-output",
                                CodexEvent::Output { text: line },
                            );
                        }
                    }
                }
            }
        });

        // 线程：读取 stderr（纯文本进度信息）
        let app_stderr = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if !line.trim().is_empty() {
                        let _ = app_stderr.emit(
                            "codex-output",
                            CodexEvent::Error { message: line },
                        );
                    }
                }
            }
        });

        // 轮询等待子进程结束，加 120 秒超时
        let start = Instant::now();
        let exit_code = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status.code().unwrap_or(-1),
                Ok(None) => {
                    if start.elapsed() > Duration::from_secs(120) {
                        let _ = child.kill();
                        let _ = child.wait();
                        break -1;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                Err(e) => return Err(format!("Failed to wait for codex process: {}", e)),
            }
        };

        // 推送完成事件
        app.emit("codex-done", CodexEvent::Done { exit_code })
            .map_err(|e| format!("Failed to emit codex done event: {}", e))?;

        Ok(())
    }
}
