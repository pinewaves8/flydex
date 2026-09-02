use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::services::security::SecurityService;
use crate::types::codex::CodexEvent;

/// Codex 执行模式
#[derive(Debug, Clone, Copy)]
pub enum CodexExecMode {
    /// 首轮执行：codex exec --json
    Exec,
    /// 恢复会话：codex exec resume --last --json
    Resume,
    /// 计划模式：沙箱强制 read-only（只出计划不改文件）+ 注入计划指令；
    /// 已有会话则 resume 保持对话上下文，否则新开首轮
    Plan,
    /// 审查模式：沙箱强制 read-only（只读 diff 出报告，不改文件）+ 注入审查指令；
    /// 已有会话则 resume 保持对话上下文，否则新开首轮
    Review,
}

/// 计划模式注入的系统指令：强制模型只输出计划、不执行任何写操作。
/// 配合 read-only 沙箱形成双重约束（指令约束 + 硬权限约束）。
/// 审查模式注入的系统指令：要求模型读取工作目录下的 .flydex-review.diff 并输出
/// 结构化审查报告（级别|文件:行号|概述|建议，每行一条，最后一行审查总结）。
/// 单行书写：命令行经 cmd /c 传递，含换行会被截断。
const REVIEW_INSTRUCTION: &str = "【代码审查模式】你正在以资深工程师视角审查代码变更。diff 内容已保存在工作目录下的 .flydex-review.diff 文件中，请先用读取工具读取该文件，再输出结构化审查报告。输出格式要求（必须严格遵守）：0) 不要输出任何解释、开场白、markdown 列表符号(- * 1.)或分隔线(---)，直接输出内容；1) 第一行输出：总评：xxx；2) 之后每行一个问题，行首直接以级别开头，格式：级别|文件:行号|问题概述|修改建议，级别只能取【严重】【警告】【建议】【好评】之一（好评用于肯定做得好的点），文件与行号必须来自 diff 中的真实位置，行号对应新文件行号；3) 即使没有严重问题也至少要给出一条好评或说明；4) 最后一行输出：审查总结：xxx。5) 不要重复输出任何内容，每条问题与总结只出现一次。";

const PLAN_INSTRUCTION: &str = "【计划模式】你当前的工作目录是只读的，无法创建、修改或删除任何文件。请先充分分析用户需求（可以读取和搜索代码与文件），然后输出一份分步执行计划，不要实际执行任何修改。要求：1) 用编号列表分步列出，每一步【单独一行】，格式为：数字. 具体操作（例如：1. 在根目录创建 demo.txt 并写入 hello）；2) 禁止输出嵌套子列表（不要'涉及文件/具体操作'子项）、禁止加粗标题、禁止计划总结或前言；3) 每步要具体、可执行、覆盖边界情况；4) 只输出计划本身，不要执行任何写操作。";

/// 运行中的 codex 进程句柄（供审批写入与停止）
pub struct ActiveCodex {
    /// 伪终端 master 写端（写 "y\n" / "n\n" 响应审批）
    /// Option：本轮完成后 take() 关闭 stdin（EOF），让 codex 立即退出而非空等
    pub writer: Option<Box<dyn Write + Send>>,
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
    /// 预配置 git safe.directory
    ///
    /// workspace-write 沙箱下，AI 执行 git 命令会因目录所有权检查报
    /// "detected dubious ownership"，导致 git 操作失败。这里在启动 codex 前
    /// 用真实用户权限预先信任工作目录（与 codex 沙箱无关，属于 git 客户端层面）。
    fn ensure_git_safe_directory(workdir: Option<&str>) {
        let add = |path: &str| {
            let _ = std::process::Command::new("git")
                .args(["config", "--global", "--add", "safe.directory", path])
                .status();
        };
        if let Some(dir) = workdir {
            let dir = dir.trim();
            if !dir.is_empty() {
                // 先移除旧条目避免累积，再添加
                let _ = std::process::Command::new("git")
                    .args(["config", "--global", "--unset-all", "safe.directory", dir])
                    .status();
                add(dir);
                return;
            }
        }
        // 无明确 workdir 时兜底信任所有目录
        add("*");
    }

    /// 生成模型相关 `-c` 覆盖参数
    ///
    /// 从 ~/.flydex/models.json 读取当前模型 + 供应商配置，用 `-c` 在运行时覆盖，
    /// 不修改 ~/.codex/config.toml。优先级：会话级模型 > 全局默认模型。
    /// 推理强度为 none 时不传（使用模型默认）。
    fn model_args(session_model: Option<&str>) -> Vec<String> {
        use crate::services::model::ModelService;
        let cfg = ModelService::load();
        // 会话级覆盖：仅当会话指定且存在于模型列表时采用
        let model_id = session_model
            .filter(|m| cfg.find_model(m).is_some())
            .unwrap_or(cfg.current_model.as_str());
        let Some(model) = cfg.find_model(model_id) else {
            return Vec::new();
        };
        let Some(provider) = cfg.find_provider(&model.provider) else {
            return Vec::new();
        };
        let mut args = Vec::new();
        // 重要：所有 -c 参数值都**不加引号**。Windows 下 flydex 通过 cmd /c 启动 codex，
        // 带内嵌双引号（如 -c model="x"）会被 cmd 重新解析并破坏（unexpected argument）。
        // codex 的 -c 片段解析能接受无引号的裸值。
        args.push("-c".to_string());
        args.push(format!("model={}", model.id));
        args.push("-c".to_string());
        args.push(format!("model_provider={}", provider.id));
        // name 必须非空；含中文的 name（如"阿里云 Qwen"、"Ollama（本地）"）在 cmd /c 下
        // 会解析失败，因此非 ASCII 名称回退为纯 ASCII 的 provider id。
        let safe_name = if provider.name.is_ascii() {
            provider.name.clone()
        } else {
            provider.id.clone()
        };
        args.push("-c".to_string());
        args.push(format!(
            "model_providers.{}.name={}",
            provider.id, safe_name
        ));
        args.push("-c".to_string());
        args.push(format!(
            "model_providers.{}.base_url={}",
            provider.id, provider.base_url
        ));
        if !provider.api_key.trim().is_empty() {
            args.push("-c".to_string());
            args.push(format!(
                "model_providers.{}.experimental_bearer_token={}",
                provider.id, provider.api_key
            ));
        }
        if cfg.reasoning_effort != "none" && !cfg.reasoning_effort.is_empty() {
            args.push("-c".to_string());
            args.push(format!("model_reasoning_effort={}", cfg.reasoning_effort));
        }
        args
    }

    /// 执行一条 codex 命令（阻塞到进程结束，输出流式推送）
    ///
    /// # Arguments
    /// * `app` - Tauri 应用句柄
    /// * `command` - 用户指令文本
    /// * `workdir` - 工作目录（可选）
    /// * `mode` - 执行模式（Exec 首轮 / Resume 恢复会话）
    /// * `thread_id` - 恢复指定会话（可选）
    /// * `run_id` - 本次运行的唯一标识（审批/停止用）
    /// * `session_model` - 会话级模型覆盖（可选，None 用全局默认）
    pub fn run_command(
        app: AppHandle,
        command: String,
        workdir: Option<String>,
        mode: CodexExecMode,
        thread_id: Option<String>,
        run_id: String,
        session_model: Option<String>,
        images: Option<Vec<String>>,
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
            CodexExecMode::Plan | CodexExecMode::Review => {
                // 计划/审查模式：已有会话则 resume 保持对话上下文（仍在只读沙箱下）
                if let Some(tid) = &thread_id {
                    args.push("resume".to_string());
                    args.push(tid.clone());
                }
            }
        }
        args.push("--json".to_string());
        // 桌面应用场景：用户主动选择工作目录（常为非 git 项目），跳过 codex 的
        // "trusted directory" 检查，否则非 git 目录直接报 "Not inside a trusted directory"。
        // 实际安全边界由 sandbox_mode（read-only / workspace-write / danger-full-access）控制。
        args.push("--skip-git-repo-check".to_string());
        // 从安全配置读取沙箱模式，统一用 `-c` 覆盖（exec 与 resume 均支持）。
        // 沙箱：read-only / workspace-write / danger-full-access（真实用户权限，AI 可完成 git 写操作）
        // 审批策略：exec 模式**强制 approval_policy=never**（headless 下无法交互审批——
        // codex exec 对 CommandExecutionRequestApproval / FileChangeRequestApproval 一律直接拒绝
        // （"not supported in exec mode"），on-request/untrusted 只会导致 AI 写文件/跑命令被拒。
        // 安全边界完全由 sandbox_mode 承担：用户切 read-only 即只读，workspace-write/danger-full-access 即可写。
        let sec = SecurityService::load();
        // 所有 -c 值一律不加引号（cmd /c 重新解析会破坏内嵌引号），含连字符的值也可安全裸传
        // 计划模式强制 read-only 沙箱（模型只能分析出计划，无法修改任何文件）；其余用用户安全配置
        let sandbox = match mode {
            CodexExecMode::Plan | CodexExecMode::Review => "read-only",
            _ => sec.sandbox_mode.as_codex(),
        };
        args.push("-c".to_string());
        args.push(format!("sandbox_mode={}", sandbox));
        // exec 模式强制 never（无法交互审批）；后端不再向 exec 传 on-request/untrusted
        args.push("-c".to_string());
        args.push("approval_policy=never".to_string());
        // 模型参数：会话级覆盖 > 全局默认
        args.extend(Self::model_args(session_model.as_deref()));
        // 计划模式：在用户指令前注入计划指令（配合 read-only 沙箱双重约束）
        let mut final_command = match mode {
            CodexExecMode::Plan => format!(
                "{} 用户需求：{}",
                PLAN_INSTRUCTION,
                command.replace(['\n', '\r'], " ")
            ),
            CodexExecMode::Review => format!(
                "{} 审查指令：{}",
                REVIEW_INSTRUCTION,
                command.replace(['\n', '\r'], " ")
            ),
            _ => command.clone(),
        };
        // 空指令保护：codex exec 强制要求 prompt，空串会报 "No prompt provided"。
        // 纯图片发送（无文字）时注入默认指令，让 codex 基于附加图片回复；两者皆空则报错。
        if final_command.trim().is_empty() {
            if images.as_ref().is_some_and(|v| !v.is_empty()) {
                final_command = "请描述你看到的图片内容，并结合项目上下文给出分析和建议。".to_string();
            } else {
                return Err("指令不能为空：请先输入消息，或附加图片后发送。".to_string());
            }
        }
        // 图像附件：通过 -i 传给 codex（相对路径 ./.flydex-attachments/xxx）
        if let Some(imgs) = &images {
            for img in imgs {
                args.push("-i".to_string());
                args.push(img.clone());
            }
        }
        args.push(final_command);

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
        // 调试日志：打印实际传给 codex 的完整命令行，便于排查 cmd /c 参数解析问题
        eprintln!("[codex] full command: codex {}", args.join(" "));
        // 同时写入项目根 .codex-cmd.log（Windows 下 tauri dev 控制台不可见时用）
        if let Some(dir) = &workdir {
            if let Ok(log_path) = std::path::Path::new(dir).join(".codex-cmd.log").into_os_string().into_string() {
                let _ = std::fs::OpenOptions::new()
                    .create(true).append(true).open(&log_path)
                    .and_then(|mut f| {
                        use std::io::Write;
                        let _ = writeln!(f, "[{}] codex {}", run_id, args.join(" "));
                        Ok(())
                    });
            }
        }

        // 预配置 git safe.directory，避免 workspace-write 下 AI 的 git 操作失败
        Self::ensure_git_safe_directory(workdir.as_deref());

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
                writer: Some(writer),
                child: child.clone(),
            },
        );

        app.emit("codex-output", CodexEvent::Started { pid })
            .map_err(|e| format!("Failed to emit started event: {}", e))?;

        // 读线程：阻塞读 master（TTY 行缓冲 → 流式），过滤控制序列，解析 JSONL
        // turn_done：解析到 turn.completed 后置位，主线程据此关闭 stdin 让 codex 尽快退出
        let turn_done = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let app_reader = app.clone();
        let turn_done_reader = turn_done.clone();
        let reader_thread = std::thread::spawn(move || {
            let mut reader = BufReader::new(reader);
            // 累积解析：PTY 按终端宽度（160 列）会把长 JSON（如 mcp_tool_call 的大结果）
            // wrap 拆成多物理行。codex --json 的 JSON 一律以 `{` 开头，因此以该特征判断：
            // 新行以 `{` 开头 → 上一段累积已完整 → 尝试解析并 emit；否则为 wrap 延续/普通文本，累积。
            let mut pending = String::new();
            let mut line = String::new();
            // 处理一段累积缓冲：尝试作为 JSON（去掉 wrap 换行）解析，失败则按普通文本输出
            let mut emit_pending = |buf: &str| {
                if buf.is_empty() {
                    return;
                }
                let compact: String = buf.chars().filter(|&c| c != '\n').collect();
                match serde_json::from_str::<serde_json::Value>(&compact) {
                    Ok(json) => {
                        if json.get("type").and_then(|v| v.as_str()) == Some("turn.completed") {
                            turn_done_reader.store(true, std::sync::atomic::Ordering::Relaxed);
                        }
                        let _ = app_reader.emit("codex-output", CodexEvent::Json(json));
                    }
                    Err(_) => {
                        let _ = app_reader
                            .emit("codex-output", CodexEvent::Output { text: buf.to_string() });
                    }
                }
            };
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break, // EOF（writer 释放/进程退出）
                    Ok(_) => {
                        let clean = clean_line(&line);
                        let trimmed = clean.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        if trimmed.starts_with('{') {
                            // 新 JSON 起点：先解析并清空已有累积
                            emit_pending(&pending);
                            pending.clear();
                        } else if !pending.is_empty() {
                            // wrap 延续或普通文本段：保留换行追加
                            pending.push('\n');
                        }
                        pending.push_str(trimmed);
                    }
                    Err(_) => break,
                }
            }
            // 进程退出时若有残留累积，原样输出避免吞数据
            emit_pending(&pending);
        });

        // 主流程：轮询子进程退出（带超时兜底）
        // 超时设为 600s：本地 ollama 大模型（如 qwen2.5-coder:latest 4.7GB）冷加载 +
        // 生成首 token 可能需 2~5 分钟；120s 会误杀导致 exit -1。云端模型通常数十秒内完成。
        const CODEX_TIMEOUT: Duration = Duration::from_secs(600);
        let start = std::time::Instant::now();
        let mut done_sent = false;
        let exit_code = loop {
            let mut guard = child.lock().unwrap();
            match guard.try_wait() {
                Ok(Some(status)) => {
                    break if status.success() { 0 } else { status.exit_code() as i32 };
                }
                Ok(None) => {
                    drop(guard);
                    // 本轮已结束（turn.completed）→ 立即推送 done，让前端快速结束 "Running…"。
                    // 注意：不能 kill 进程，否则 codex 来不及把会话持久化到本地，
                    // 下一轮 resume 会丢失上下文（用户告诉过名字/背景，第二轮回不上来）。
                    // 保持 stdin 打开，让 codex 自然收尾退出（实测 ~16s 内）。
                    if turn_done.load(std::sync::atomic::Ordering::Relaxed) && !done_sent {
                        done_sent = true;
                        let _ = app.emit("codex-done", CodexEvent::Done { exit_code: 0 });
                    }
                    if start.elapsed() > CODEX_TIMEOUT {
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

        // 推送完成事件（若 turn.completed 已提前推送过，则不重复）
        if !done_sent {
            app.emit("codex-done", CodexEvent::Done { exit_code })
                .map_err(|e| format!("Failed to emit codex done event: {}", e))?;
        }

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
        let writer = entry
            .writer
            .as_mut()
            .ok_or_else(|| format!("No active writer for run_id: {}", run_id))?;
        writer
            .write_all(resp.as_bytes())
            .and_then(|_| writer.flush())
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
