use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::services::appserver_client::AppServerClient;
use crate::services::hooks::HooksService;
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

/// 活动 turn 注册表（run_id -> (thread_id, turn_id)），供 stop 中断
static ACTIVE_TURNS: OnceLock<Mutex<HashMap<String, (String, String)>>> = OnceLock::new();

fn active_turns() -> &'static Mutex<HashMap<String, (String, String)>> {
    ACTIVE_TURNS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Codex CLI 子进程管理器（PTY 伪终端流式）
///
/// 通过 portable-pty 给 codex 挂 TTY，强制行缓冲流式输出；
/// 解析 JSONL 事件推送到前端；支持审批（写 stdin）与停止（kill）。
pub struct CodexManager;

/// 每次运行的覆盖项(全部来自前端)
///
/// 收成一个结构体而不是继续加位置参数 —— 这些字段都只在「这一次运行」有效,
/// 且调用点只有一个(commands/codex.rs)。
#[derive(Debug, Default, Clone)]
pub struct RunOverrides {
    /// 会话级模型覆盖(`None` = 用全局配置)
    pub model: Option<String>,
    pub images: Option<Vec<String>>,
    /// 沙箱模式覆盖(子代理可配)
    pub sandbox: Option<String>,
}

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
        const WORDS: &[&str] = &[
            "搜索",
            "搜一下",
            "搜索一下",
            "查一下",
            "查找",
            "查询",
            "检索",
            "search",
            "look up",
            "find",
        ];
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
        String::from_utf8(out.stdout)
            .ok()
            .filter(|s| !s.trim().is_empty())
    }

    pub fn run_command(
        app: AppHandle,
        command: String,
        workdir: Option<String>,
        mode: CodexExecMode,
        thread_id: Option<String>,
        run_id: String,
        ov: RunOverrides,
    ) -> Result<(), String> {
        // 沙箱边界：per-run 覆盖（子代理可配）> 计划/审查强制只读 > 全局配置
        // （通过 app-server thread/start 的 sandbox 参数传递，见下方 thread_start）
        let sec = SecurityService::load();
        let sandbox = match ov.sandbox.clone() {
            Some(s) => s,
            None => match mode {
                CodexExecMode::Plan | CodexExecMode::Review => "read-only".to_string(),
                _ => sec.sandbox_mode.as_codex().to_string(),
            },
        };
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
            if ov.images.as_ref().is_some_and(|v| !v.is_empty()) {
                final_command =
                    "请描述你看到的图片内容，并结合项目上下文给出分析和建议。".to_string();
            } else {
                return Err("指令不能为空：请先输入消息，或附加图片后发送。".to_string());
            }
        }

        // 记忆注入（6.1）：L1 用户记忆 + L2 项目记忆（.flydex/MEMORY.md）拼到指令前。
        // 放在空指令保护之后，避免纯记忆被误当成用户指令发送。
        let memory_block =
            crate::services::memory::MemoryService::build_inject_block(workdir.as_deref());
        if !memory_block.trim().is_empty() {
            final_command = format!("{}\n\n{}", memory_block.trim_end(), final_command);
        }

        // 搜索预取（确定性兜底）：命中搜索意图时，由 flydex 代检索一次并注入结果，
        // 不依赖模型自觉调用 web_search。仅命中搜索触发词的指令生效，不影响其他对话。
        if let Some(prefetch) = Self::prefetch_search(&final_command) {
            final_command = format!("{}\n\n{}", final_command.trim_end(), prefetch);
        }
        // ── app-server 驱动（6.2）：headless exec → codex app-server（执行前审批）──
        let client = AppServerClient::ensure(app.clone())?;
        // 前端 UX：Started 事件（app-server 无真实 pid，用 0 占位）
        let _ = app.emit(
            "codex-output",
            CodexEvent {
                run_id: run_id.clone(),
                body: CodexEventBody::Started { pid: 0 },
            },
        );

        // 确定 thread：resume 复用传入 thread_id（先 thread/resume 重新 open，
        // 否则 app-server 重启后 thread 不在内存 → turn/start 报 thread not found），
        // 恢复失败则降级为新开会话；否则 thread/start 新开会话。
        let mut tp = serde_json::json!({
            "cwd": workdir.clone().unwrap_or_default(),
            "approvalPolicy": "on-request",
            "approvalsReviewer": "user",
            "sandbox": sandbox,
        });
        // per-thread config 层(优先级高于全局 ~/.codex/config.toml):
        // 1) 模型 + 供应商 —— 这样既不改用户的 Codex CLI 配置,也无需重启 daemon;
        //    resume 同样携带,不存在「线程绑死旧 provider → unknown model」。
        // 2) 项目文档候选名 —— 交给 codex 自己的 AGENTS.md 加载器(它原生就读
        //    AGENTS.override.md → AGENTS.md,并按 project_doc_fallback_filenames
        //    逐个回退),我们不再自行读取与注入,避免同一份文件每轮送两遍。
        let mut cfg_map = match crate::services::model::ModelService::thread_config(
            ov.model.as_deref(),
        ) {
            Some(m) => m,
            None => {
                let _ = app.emit(
                    "codex-output",
                    CodexEvent {
                        run_id: run_id.clone(),
                        body: CodexEventBody::Output {
                            text: "▸ 未找到模型配置,将使用 codex 自身默认模型。".into(),
                        },
                    },
                );
                serde_json::Map::new()
            }
        };
        // codex 在每个目录按顺序取首个命中,故这些只在没有 AGENTS.md 时才生效
        cfg_map.insert(
            "project_doc_fallback_filenames".into(),
            serde_json::json!(["CLAUDE.md", "CONVENTIONS.md", ".flydex/CONVENTIONS.md"]),
        );
        tp["config"] = serde_json::Value::Object(cfg_map);

        let tid = match thread_id {
            Some(tid) if !tid.trim().is_empty() => match client.thread_resume(&tid, tp.clone()) {
                Ok(resumed_tid) => resumed_tid,
                Err(e) => {
                    let _ = app.emit(
                        "codex-output",
                        CodexEvent {
                            run_id: run_id.clone(),
                            body: CodexEventBody::Output {
                                text: format!(
                                    "⚠️ 恢复会话失败：{e}；已新建会话（不保留历史上下文）。"
                                ),
                            },
                        },
                    );
                    client.thread_start(tp)?
                }
            },
            _ => client.thread_start(tp)?,
        };

        // 绑定 run_id（事件路由）
        client.bind_run(&tid, &run_id);

        // 图像附件：app-server 的 UserInput 支持 image 类型（data URL），
        // Phase 1 仅支持文本输入，图片后续接入。
        if ov.images.as_ref().is_some_and(|v| !v.is_empty()) {
            let _ = app.emit(
                "codex-output",
                CodexEvent {
                    run_id: run_id.clone(),
                    body: CodexEventBody::Output {
                        text: "⚠️ app-server 驱动暂未接入图片输入，已忽略图片附件。".into(),
                    },
                },
            );
        }

        let turn_id = client.turn_start(
            &tid,
            serde_json::json!([{"type": "text", "text": final_command}]),
            None,
        )?;

        // 记录活动 turn（供 stop 中断）
        active_turns()
            .lock()
            .unwrap()
            .insert(run_id.clone(), (tid.clone(), turn_id.clone()));

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
        // Hooks:用户主动停止时触发(可配置:备份未保存改动/通知等)
        HooksService::fire(
            "Stop",
            &serde_json::json!({
                "run_id": run_id,
            }),
        );
        Ok(())
    }
}
