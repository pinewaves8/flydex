use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::services::appserver_client::AppServerClient;
use crate::services::security::SecurityService;
use crate::types::codex::{CodexEvent, CodexEventBody};

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

/// 活动 turn 注册表（run_id -> (thread_id, turn_id)），供 stop 中断
static ACTIVE_TURNS: OnceLock<Mutex<HashMap<String, (String, String)>>> = OnceLock::new();

fn active_turns() -> &'static Mutex<HashMap<String, (String, String)>> {
    ACTIVE_TURNS.get_or_init(|| Mutex::new(HashMap::new()))
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
    /// 搜索预取（确定性兜底）：命中搜索意图时，由 flydex 代检索一次并注入结果。
    /// 仅命中搜索触发词的指令生效，不影响其他对话；预取失败/无搜索意图时返回 None。
    fn prefetch_search(cmd: &str) -> Option<String> {
        let user_input = Self::extract_instruction(cmd)?;
        if !Self::is_search_intent(&user_input) {
            return None;
        }
        let query = Self::extract_query(&user_input);
        if query.is_empty() {
            return None;
        }
        let output = Self::run_search_prefetch(&query)?;
        Some(format!(
            "【预取搜索结果·flydex 自动检索，仅供参考，可能含同名/泛化页面，请以 web_search 精确核实为准】\n{}",
            output
        ))
    }

    /// 从前端注入格式中提取【用户指令】后的内容
    fn extract_instruction(cmd: &str) -> Option<String> {
        const MARK: &str = "【用户指令】";
        let start = cmd.find(MARK)? + MARK.len();
        let rest = &cmd[start..];
        let end = rest.find('\n').unwrap_or(rest.len());
        let s = rest[..end].trim();
        if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        }
    }

    /// 检测是否命中搜索意图（与前端 matchTriggers 对齐）
    fn is_search_intent(s: &str) -> bool {
        const WORDS: &[&str] = &["搜索", "搜一下", "搜索一下", "查一下", "查找", "查询", "检索", "search", "look up", "find"];
        let lower = s.to_lowercase();
        WORDS.iter().any(|w| lower.contains(w))
    }

    /// 提取搜索查询词：去掉"搜索/查找/查询"等动词与客气词，保留实体
    fn extract_query(s: &str) -> String {
        let cleaned = s
            .replace("搜索一下", " ")
            .replace("搜索", " ")
            .replace("搜一下", " ")
            .replace("查一下", " ")
            .replace("查找", " ")
            .replace("查询", " ")
            .replace("检索", " ")
            .replace("帮我", " ")
            .replace("请", " ");
        cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    /// 调用 web-search server 的 CLI 预取模式执行一次搜索
    fn run_search_prefetch(query: &str) -> Option<String> {
        // web-search server 固定位于项目 mcp/ 下；预取失败时静默返回 None，不影响原路径
        let server = r"C:\llm\flydex\mcp\web-search-server.mjs";
        let out = std::process::Command::new("node")
            .args([server, "--query", query])
            .output()
            .ok()?;
        if !out.status.success() || out.stdout.is_empty() {
            return None;
        }
        String::from_utf8(out.stdout).ok().filter(|s| !s.trim().is_empty())
    }

    pub fn run_command(
        app: AppHandle,
        command: String,
        workdir: Option<String>,
        mode: CodexExecMode,
        thread_id: Option<String>,
        run_id: String,
        session_model: Option<String>,
        images: Option<Vec<String>>,
        sandbox: Option<String>,
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
        // 沙箱边界：per-run 覆盖（子代理可配）> 计划/审查强制只读 > 全局配置
        let sandbox = match sandbox {
            Some(s) => s,
            None => match mode {
                CodexExecMode::Plan | CodexExecMode::Review => "read-only".to_string(),
                _ => sec.sandbox_mode.as_codex().to_string(),
            },
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
        
        // 记忆注入（6.1）：L1 用户记忆 + L2 项目记忆（.flydex/MEMORY.md）拼到指令前。
        // 放在空指令保护之后，避免纯记忆被误当成用户指令发送。
        let memory_block = crate::services::memory::MemoryService::build_inject_block(workdir.as_deref());
        if !memory_block.trim().is_empty() {
            final_command = format!("{}\n\n{}", memory_block.trim_end(), final_command);
        }
        // 搜索预取（确定性兜底）：命中搜索意图时，由 flydex 代检索一次并注入结果，
        // 不依赖模型自觉调用 web_search。仅命中搜索触发词的指令生效，不影响其他对话。
        if let Some(prefetch) = Self::prefetch_search(&final_command) {
            final_command = format!("{}\n\n{}", final_command.trim_end(), prefetch);
        }
// 图像附件：通过 -i 传给 codex（相对路径 ./.flydex-attachments/xxx）。
        // 注意：-i/--image 是 num_args=1.. 的贪婪多值参数，会吞掉其后的所有非 option 参数（含 prompt），
        // 因此 prompt 必须先入 args，-i 图片必须排在 prompt 之后，否则 codex 报 "No prompt provided"。

        // ── app-server 驱动（6.2）：headless exec → codex app-server（执行前审批）──
        let client = AppServerClient::ensure(app.clone())?;
        // 前端 UX：Started 事件（app-server 无真实 pid，用 0 占位）
        let _ = app.emit(
            "codex-output",
            CodexEvent { run_id: run_id.clone(), body: CodexEventBody::Started { pid: 0 } },
        );


        // 确定 thread：resume 复用传入 thread_id，否则新开会话
        let tid = match thread_id {
            Some(tid) if !tid.trim().is_empty() => tid.clone(),
            _ => {
                let mut tp = serde_json::json!({
                    "cwd": workdir.clone().unwrap_or_default(),
                    "approvalPolicy": "on-request",
                    "approvalsReviewer": "user",
                    "sandbox": sandbox,
                });
                if let Some(m) = session_model.clone().filter(|s| !s.is_empty()) {
                    tp["model"] = serde_json::Value::String(m);
                }
                client.thread_start(tp)?
            }
        };

        // 绑定 run_id（事件路由）
        client.bind_run(&tid, &run_id);

        // 图像附件：app-server 的 UserInput 支持 image 类型（data URL），
        // Phase 1 仅支持文本输入，图片后续接入。
        if images.as_ref().is_some_and(|v| !v.is_empty()) {
            let _ = app.emit(
                "codex-output",
                CodexEvent { run_id: run_id.clone(), body: CodexEventBody::Output { text: "⚠️ app-server 驱动暂未接入图片输入，已忽略图片附件。".into() } },
            );
        }

        let turn_id = client.turn_start(&tid, serde_json::json!([{"type": "text", "text": final_command}]), None)?;

        // 记录活动 turn（供 stop 中断）
        active_turns().lock().unwrap().insert(run_id.clone(), (tid.clone(), turn_id.clone()));

        // 阻塞等待该 turn 完成（读线程 turn/completed 时发信号）：
        // app-server 下 turn 由 daemon 异步执行，若此处直接返回，前端 run() 的
        // "invoke 返回即结束"兜底会误触发 done + 清空 pendingRunId，导致后续
        // 工具卡片/回复事件被前端过滤丢弃（"几秒就结束、什么也没做"）。
        let (turn_done_tx, turn_done_rx) = std::sync::mpsc::channel::<()>();
        crate::services::appserver_client::turn_done()
            .lock()
            .unwrap()
            .insert(run_id.clone(), turn_done_tx);
        // 超时兜底（15min，几乎不会触发；daemon 死亡/EOF 会立即解除等待）
        let _ = turn_done_rx.recv_timeout(Duration::from_secs(900));

        // 事件流式由 daemon 读线程推前端；turn/completed 时已 emit codex-done。
        Ok(())
    }
    /// 审批响应（app-server）：用户在前端审批卡片点允许/拒绝 → respond 挂起的 ServerRequest
    pub fn approve(run_id: &str, approval_id: &str, approve: bool) -> Result<(), String> {
        let _ = run_id;
        AppServerClient::respond_approval(approval_id, approve)
    }

    /// 停止运行中的 codex（kill 进程树）
    pub fn stop(run_id: &str) -> Result<(), String> {
        // 中断活动 turn（优雅中断）
        let entry = active_turns().lock().unwrap().get(run_id).cloned();
        if let Some((tid, turn_id)) = entry {
            if let Some(client) = AppServerClient::global() {
                let _ = client.turn_interrupt(&tid, &turn_id);
            }
        }
        Ok(())
    }
}
