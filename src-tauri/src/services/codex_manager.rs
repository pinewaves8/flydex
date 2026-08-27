use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::types::codex::CodexEvent;

/// Codex 执行模式
#[derive(Debug, Clone, Copy)]
pub enum CodexExecMode {
    /// 首轮执行：codex exec --json
    Exec,
    /// 恢复会话：codex exec resume --last --json
    Resume,
}

/// 运行中的 codex 进程句柄（供审批写入与停止）
pub struct ActiveCodex {
    /// 伪终端 master 写端（写 "y\n" / "n\n" 响应审批）
    pub writer: Box<dyn Write + Send>,
    /// 子进程句柄（用于停止/超时 kill）
    pub child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

/// 全局运行中 codex 注册表（run_id -> ActiveCodex）
static ACTIVE: OnceLock<Mutex<HashMap<String, ActiveCodex>>> = OnceLock::new();

fn active() -> &'static Mutex<HashMap<String, ActiveCodex>> {
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 清理 conpty/ANSI 控制序列，恢复纯文本
///
/// 处理：OSC 窗口标题（ESC ] ... BEL）、CSI（ESC [ ... 字母）、CR。
fn clean_line(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        match c {
            '\u{1b}' => match chars.next() {
                Some(']') => {
                    // OSC 序列：跳到 BEL（内容可能含字母，如路径 C:\...）
                    for n in chars.by_ref() {
                        if n == '\u{7}' {
                            break;
                        }
                    }
                }
                Some('[') => {
                    // CSI 序列：跳到终止字母
                    for n in chars.by_ref() {
                        if n.is_ascii_alphabetic() {
                            break;
                        }
                    }
                }
                _ => {}
            },
            '\r' => {}
            c => out.push(c),
        }
    }
    out
}

/// Codex CLI 子进程管理器（PTY 伪终端流式）
///
/// 通过 portable-pty 给 codex 挂 TTY，强制行缓冲流式输出；
/// 解析 JSONL 事件推送到前端；支持审批（写 stdin）与停止（kill）。
pub struct CodexManager;

impl CodexManager {
    /// 执行一条 codex 命令（阻塞到进程结束，输出流式推送）
    ///
    /// # Arguments
    /// * `app` - Tauri 应用句柄
    /// * `command` - 用户指令文本
    /// * `workdir` - 工作目录（可选）
    /// * `mode` - 执行模式（Exec 首轮 / Resume 恢复会话）
    /// * `thread_id` - 恢复指定会话（可选）
    /// * `run_id` - 本次运行的唯一标识（审批/停止用）
    pub fn run_command(
        app: AppHandle,
        command: String,
        workdir: Option<String>,
        mode: CodexExecMode,
        thread_id: Option<String>,
        run_id: String,
    ) -> Result<(), String> {
        // 构建 codex 参数
        let mut args: Vec<String> = vec!["exec".to_string()];
        match mode {
            CodexExecMode::Exec => {}
            CodexExecMode::Resume => {
                args.push("resume".to_string());
                if let Some(tid) = &thread_id {
                    args.push(tid.clone());
                } else {
                    args.push("--last".to_string());
                }
            }
        }
        args.push("--json".to_string());
        // danger-full-access：以真实用户权限运行，使 AI 能完成 git 写操作，
        // 且无沙箱隔离用户的属主问题（workspace-write 会产生 dubious ownership）。
        // 安全兜底由前端的实时命令看板 + 停止按钮 + 审批事件处理提供。
        // 注意：`codex exec resume` 子命令不支持 `--sandbox`，需用等效的
        // `--dangerously-bypass-approvals-and-sandbox`（跳过确认 + 无沙箱）。
        match mode {
            CodexExecMode::Exec => {
                args.push("--sandbox".to_string());
                args.push("danger-full-access".to_string());
            }
            CodexExecMode::Resume => {
                args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
            }
        }
        args.push(command.clone());

        // 创建伪终端
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 40,
                cols: 160,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open pty: {}", e))?;

        // Windows 上通过 cmd /c 启动（codex 是 .cmd 批处理）
        let mut cb = if cfg!(windows) {
            let mut c = CommandBuilder::new("cmd.exe");
            c.args(["/c", "codex"]);
            c
        } else {
            CommandBuilder::new("codex")
        };
        for a in &args {
            cb.arg(a);
        }
        if let Some(dir) = &workdir {
            cb.cwd(dir);
        }

        let child = pair
            .slave
            .spawn_command(cb)
            .map_err(|e| format!("Failed to spawn codex: {}", e))?;
        drop(pair.slave);

        let pid = child.process_id().unwrap_or(0);
        let child = Arc::new(Mutex::new(child));

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone pty reader: {}", e))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take pty writer: {}", e))?;

        // 注册运行句柄
        active().lock().unwrap().insert(
            run_id.clone(),
            ActiveCodex {
                writer,
                child: child.clone(),
            },
        );

        app.emit("codex-output", CodexEvent::Started { pid })
            .map_err(|e| format!("Failed to emit started event: {}", e))?;

        // 读线程：阻塞读 master（TTY 行缓冲 → 流式），过滤控制序列，解析 JSONL
        let app_reader = app.clone();
        let reader_thread = std::thread::spawn(move || {
            let mut reader = BufReader::new(reader);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break, // EOF（writer 释放/进程退出）
                    Ok(_) => {
                        let clean = clean_line(&line);
                        if clean.trim().is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<serde_json::Value>(&clean) {
                            Ok(json) => {
                                let _ = app_reader.emit("codex-output", CodexEvent::Json(json));
                            }
                            Err(_) => {
                                let _ = app_reader.emit("codex-output", CodexEvent::Output { text: clean });
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // 主流程：轮询子进程退出（带 120s 超时兜底）
        let start = std::time::Instant::now();
        let exit_code = loop {
            let mut guard = child.lock().unwrap();
            match guard.try_wait() {
                Ok(Some(status)) => {
                    break if status.success() { 0 } else { status.exit_code() as i32 };
                }
                Ok(None) => {
                    drop(guard);
                    if start.elapsed() > Duration::from_secs(120) {
                        let mut g = child.lock().unwrap();
                        let _ = g.kill();
                        break -1;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                Err(_) => {
                    drop(guard);
                    break -1;
                }
            }
        };

        // 推送完成事件
        app.emit("codex-done", CodexEvent::Done { exit_code })
            .map_err(|e| format!("Failed to emit codex done event: {}", e))?;

        // 从注册表移除（drop writer → master EOF → 读线程退出）
        active().lock().unwrap().remove(&run_id);

        // 等待读线程收尾
        let _ = reader_thread.join();

        Ok(())
    }

    /// 审批响应：向运行中的 codex 写入 y/n
    pub fn approve(run_id: &str, approve: bool) -> Result<(), String> {
        let mut map = active().lock().unwrap();
        let entry = map
            .get_mut(run_id)
            .ok_or_else(|| format!("No active codex for run_id: {}", run_id))?;
        let resp = if approve { "y\n" } else { "n\n" };
        entry
            .writer
            .write_all(resp.as_bytes())
            .and_then(|_| entry.writer.flush())
            .map_err(|e| format!("Failed to write approval: {}", e))
    }

    /// 停止运行中的 codex（kill 进程树）
    pub fn stop(run_id: &str) -> Result<(), String> {
        let mut map = active().lock().unwrap();
        let entry = map
            .get_mut(run_id)
            .ok_or_else(|| format!("No active codex for run_id: {}", run_id))?;
        let mut guard = entry.child.lock().unwrap();
        guard.kill().map_err(|e| format!("Failed to kill codex: {}", e))
    }
}
