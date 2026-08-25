use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::types::codex::CodexEvent;

/// Codex CLI 子进程管理器
///
/// 通过 `codex exec` 命令执行用户指令，
/// 流式读取 stdout/stderr 并通过 Tauri 事件推送到前端。
///
/// # 已知限制
/// codex exec 在非 TTY 环境下（stdout 被 pipe）会使用全缓冲模式，
/// 输出可能攒到进程结束才一次性刷新。这是 Node.js/codex 的行为，
/// 非本程序 bug。后续阶段将改用 PTY（伪终端）启动以实现真正的流式输出。
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
        // Windows 上 codex 是 .cmd 批处理文件，Rust Command::new("codex") 找不到，
        // 需要通过 cmd /c 启动，让 cmd.exe 处理 PATH 和扩展名查找
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.arg("/c").arg("codex").arg("exec").arg(&command);
            c
        } else {
            let mut c = Command::new("codex");
            c.arg("exec").arg(&command);
            c
        };

        if let Some(dir) = &workdir {
            cmd.current_dir(dir);
        }

        cmd.stdin(Stdio::null()); // 关闭 stdin，防止 codex 阻塞等待输入
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn codex process: {}", e))?;

        let pid = child.id();

        // 立即推送进程启动事件，让前端知道进程在运行
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

        // 线程：读取 stdout 并推送事件（daemon 风格，不 join）
        let app_stdout = app.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                match reader.read_line(&mut line) {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        let text = line.trim_end_matches('\n').trim_end_matches('\r').to_string();
                        let _ = app_stdout.emit("codex-output", CodexEvent::Output { text });
                        line.clear();
                    }
                    Err(_) => break,
                }
            }
        });

        // 线程：读取 stderr 并推送事件（daemon 风格，不 join）
        let app_stderr = app.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        let message = line.trim_end_matches('\n').trim_end_matches('\r').to_string();
                        let _ = app_stderr.emit("codex-output", CodexEvent::Error { message });
                        line.clear();
                    }
                    Err(_) => break,
                }
            }
        });

        // 轮询等待子进程结束，加 120 秒超时
        // 用 try_wait 而非 wait，避免无限阻塞（codex 子进程可能持有 pipe 导致 wait 不返回）
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

        // 关键：子进程已退出，立即推送 done 事件
        // 不等待读取线程——codex 可能 spawn 孙进程持有 pipe，导致读取线程永远等不到 EOF
        app.emit("codex-done", CodexEvent::Done { exit_code })
            .map_err(|e| format!("Failed to emit codex done event: {}", e))?;

        Ok(())
    }
}
