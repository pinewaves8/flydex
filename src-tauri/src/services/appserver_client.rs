//! AppServer 驱动层：把 codex 从 exec（headless、无执行前审批）切换为
//! `codex app-server`（stdio JSON-RPC，执行前审批通道）。
//!
//! 设计：
//! - 单例 daemon：全局一个 `codex app-server --listen stdio://` 子进程，多会话（thread）共享；
//! - JSON-RPC：NDJSON 逐行，id/method/params + result/error；
//! - 写独占：stdin 由专用 writer 线程独占，其余线程经 mpsc 发消息（std ChildStdin 不可跨线程）；
//! - 事件映射：把 app-server 的 notification 转成前端已兼容的 exec 风格 JSON 事件
//!   （item.completed / thread.started / turn.completed），前端零改动；
//! - 审批：ServerRequest（commandExecution/fileChange/permissions requestApproval）
//!   在工具执行前到达，先判断（规则引擎/默认策略）再响应 accept/decline —— 真正"先判断再执行"。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::services::security::{ApprovalRecord, RuleDecision, SecurityService};
use crate::types::codex::{CodexEvent, CodexEventBody};

/// 调试日志：同时输出到 stderr 与 logs/flydex-appserver.log（脱机排查用）
macro_rules! debug_log {
    ($($arg:tt)*) => {{
        let s = format!($($arg)*);
        eprintln!("{s}");
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(r"C:\llm\flydex\logs\flydex-appserver.log")
        {{
            use std::io::Write;
            let _ = writeln!(f, "{s}");
        }}
    }};
}
use debug_log;

/// codex CLI 入口（全局唯一）
const CODEX_JS: &str = r"C:\Users\peter woo\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js";

/// 全局单例 app-server daemon
static APPSERVER: OnceLock<Mutex<Option<Arc<AppServerClient>>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<Arc<AppServerClient>>> {
    APPSERVER.get_or_init(|| Mutex::new(None))
}

/// run_id → turn 完成通知：run_command 阻塞等待 turn/completed（读线程发信号），
/// 保证 invoke 在 turn 真正结束前不返回（前端 run() 的"invoke 返回即结束"兜底
/// 因此不会误触发、pendingRunId 不会被提前清空导致事件被丢弃）。
static TURN_DONE: OnceLock<Mutex<HashMap<String, mpsc::Sender<()>>>> = OnceLock::new();

pub fn turn_done() -> &'static Mutex<HashMap<String, mpsc::Sender<()>>> {
    TURN_DONE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 待用户审批的请求（ask 决策挂起，等前端响应；同刻最多一个，但按 id 精确路由）
static PENDING_APPROVALS: OnceLock<Mutex<HashMap<String, PendingApproval>>> = OnceLock::new();

/// 挂起的审批请求：app-server ServerRequest id + 命令信息
pub struct PendingApproval {
    pub server_id: i64,
    pub command: String,
    pub method: String,
}

fn pending_approvals() -> &'static Mutex<HashMap<String, PendingApproval>> {
    PENDING_APPROVALS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 发往 writer 线程的消息
enum OutMsg {
    Request { id: i64, method: String, params: Option<serde_json::Value> },
    Notification { method: String, params: Option<serde_json::Value> },
    Response { id: i64, result: serde_json::Value },
}

/// 会话元信息（resume 复用）
#[derive(Clone)]
pub struct ThreadMeta {
    pub thread_id: String,
    pub model: String,
    pub cwd: String,
}

/// app-server 客户端
pub struct AppServerClient {
    _child: Child,
    out_tx: mpsc::Sender<OutMsg>,
    next_id: AtomicI64,
    /// 请求 id → 响应通道（oneshot）
    pending: Arc<Mutex<HashMap<i64, mpsc::Sender<serde_json::Value>>>>,
    /// thread_id → 最近一次 turn 的 run_id（事件路由到前端用）
    run_registry: Arc<Mutex<HashMap<String, String>>>,
    thread_registry: Mutex<HashMap<String, ThreadMeta>>,
    app: AppHandle,
}

impl AppServerClient {
    /// 获取单例（未启动则 spawn + initialize）
    pub fn ensure(app: AppHandle) -> Result<Arc<Self>, String> {
        let mut guard = slot().lock().map_err(|e| e.to_string())?;
        if let Some(c) = guard.as_ref() {
            return Ok(c.clone());
        }
        let client = Self::spawn(app.clone())?;
        let arc = Arc::new(client);
        *guard = Some(arc.clone());
        Ok(arc)
    }

    /// 获取已启动的全局单例（无则 None；stop 等不需要 AppHandle 的场景用）
    pub fn global() -> Option<Arc<Self>> {
        slot().lock().ok().and_then(|g| g.clone())
    }

    /// 关闭 daemon（用于重启/清理）
    pub fn shutdown() {
        if let Ok(mut guard) = slot().lock() {
            if let Some(c) = guard.take() {
                let _ = c.out_tx.send(OutMsg::Notification {
                    method: "shutdown".to_string(),
                    params: None,
                });
            }
        }
    }

    fn spawn(app: AppHandle) -> Result<Self, String> {
        let mut cmd = Command::new("node");
        cmd.arg(CODEX_JS).arg("app-server").arg("--listen").arg("stdio://");
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.env("NO_COLOR", "1");
        let mut child = cmd.spawn().map_err(|e| format!("spawn codex app-server 失败: {e}"))?;
        let stdin = child.stdin.take().ok_or("app-server 无 stdin")?;
        let stdout = child.stdout.take().ok_or("app-server 无 stdout")?;
        let stderr = child.stderr.take().ok_or("app-server 无 stderr")?;

        // stderr 必须持续读取：app-server 启动/MCP 调用会写 stderr 日志，
        // 若不读会填满管道缓冲（几 KB）导致 app-server 阻塞在 stderr 写入、
        // 不再处理任何 turn 消息（thread/start 早启动可成功，turn/start 后卡死）。
        let _ = std::thread::Builder::new()
            .name("appserver-stderr".into())
            .spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    let l = line.unwrap_or_default();
                    debug_log!("[app-server-stderr] {}", l.chars().take(400).collect::<String>());
                }
            });

        // writer 线程：独占 stdin
        let (out_tx, out_rx) = mpsc::channel::<OutMsg>();
        let writer = std::thread::Builder::new()
            .name("appserver-writer".into())
            .spawn(move || {
                let mut w = stdin;
                while let Ok(msg) = out_rx.recv() {
                    let payload: Option<String> = match msg {
                        OutMsg::Request { id, method, params } => {
                            let mut m = serde_json::json!({ "id": id, "method": method });
                            if let Some(p) = params {
                                m["params"] = p;
                            }
                            Some(serde_json::to_string(&m).unwrap_or_default())
                        }
                        OutMsg::Notification { method, params } => {
                            let mut m = serde_json::json!({ "method": method });
                            if let Some(p) = params {
                                m["params"] = p;
                            }
                            Some(serde_json::to_string(&m).unwrap_or_default())
                        }
                        OutMsg::Response { id, result } => {
                            Some(serde_json::to_string(&serde_json::json!({ "id": id, "result": result })).unwrap_or_default())
                        }
                    };
                    let Some(payload) = payload else { continue };
                    if w.write_all(payload.as_bytes()).is_err() {
                        break;
                    }
                    if w.write_all(b"\n").is_err() || w.flush().is_err() {
                        break;
                    }
                }
            })
            .map_err(|e| format!("spawn writer 线程失败: {e}"))?;
        let _ = writer;

        let pending: Arc<Mutex<HashMap<i64, mpsc::Sender<serde_json::Value>>>> = Arc::new(Mutex::new(HashMap::new()));
        let run_registry: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));

        let client = Self {
            _child: child,
            out_tx,
            next_id: AtomicI64::new(1),
            pending: pending.clone(),
            run_registry: run_registry.clone(),
            thread_registry: Mutex::new(HashMap::new()),
            app: app.clone(),
        };

        // reader 线程：逐行解析 NDJSON
        let app_r = app.clone();
        let _ = std::thread::Builder::new()
            .name("appserver-reader".into())
            .spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    let line = match line {
                        Ok(l) => l,
                        Err(_) => break,
                    };
                    if line.trim().is_empty() {
                        continue;
                    }
                    let msg: serde_json::Value = match serde_json::from_str(&line) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    eprintln!(
                        "[flydex-appserver] << line: {}",
                        line.chars().take(160).collect::<String>()
                    );
                    Self::handle_message(&msg, &pending, &run_registry, &app_r);
                }
                // EOF：所有 pending 失败
                for (_, tx) in pending.lock().unwrap().drain() {
                    let _ = tx.send(serde_json::Value::Null);
                }
                // 兜底：daemon 意外退出（无 turn/completed）时，通知所有活跃 run 结束，
                // 避免前端永远处于 running 状态
                let runs: Vec<String> = run_registry.lock().unwrap().values().cloned().collect();
                for rid in runs {
                    let _ = app_r.emit(
                        "codex-done",
                        CodexEvent { run_id: rid, body: CodexEventBody::Done { exit_code: 1 } },
                    );
                }
                run_registry.lock().unwrap().clear();
                // 解除所有 run_command 的 turn 等待（避免 invoke 永远阻塞）
                for (_, tx) in turn_done().lock().unwrap().drain() {
                    let _ = tx.send(());
                }
            });

        // initialize 握手
        let init = client.request("initialize", Some(serde_json::json!({
            "clientInfo": { "name": "flydex", "title": null, "version": env!("CARGO_PKG_VERSION") },
            "capabilities": { "experimentalApi": true },
        }))).map_err(|e| format!("app-server initialize 失败: {e}"))?;
        let _ = init;
        // ack：initialized 通知
        client.notify("initialized", None);
        Ok(client)
    }

    /// 发送请求并等待响应（超时兜底）
    pub fn request(&self, method: &str, params: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        debug_log!("[flydex-appserver] >>> request {method} id={id}");
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);
        self.out_tx
            .send(OutMsg::Request { id, method: method.to_string(), params })
            .map_err(|e| format!("daemon 通道已关闭: {e}"))?;
        match rx.recv_timeout(Duration::from_secs(90)) {
            Ok(v) => {
                if v.is_null() {
                    debug_log!("[flydex-appserver] <<< request {method} id={id} NULL (daemon exited)");
                    Err(format!("请求 {method} 无响应（daemon 已退出）"))
                } else if v.get("error").is_some() {
                    debug_log!("[flydex-appserver] <<< request {method} id={id} ERROR {:?}", v["error"]);
                    Err(format!("{method} 错误: {}", v["error"]))
                } else {
                    debug_log!("[flydex-appserver] <<< request {method} id={id} OK");
                    Ok(v.get("result").cloned().unwrap_or(serde_json::Value::Null))
                }
            }
            Err(e) => {
                self.pending.lock().unwrap().remove(&id);
                debug_log!("[flydex-appserver] <<< request {method} id={id} TIMEOUT: {e}");
                Err(format!("请求 {method} 超时: {e}"))
            }
        }
    }

    /// 发送通知（不等待响应）
    pub fn notify(&self, method: &str, params: Option<serde_json::Value>) {
        let _ = self.out_tx.send(OutMsg::Notification { method: method.to_string(), params });
    }

    /// 对服务端请求（审批等）响应 result
    pub fn respond(&self, id: i64, result: serde_json::Value) {
        let _ = self.out_tx.send(OutMsg::Response { id, result });
    }

    /// 用户通过审批 UI 响应挂起的 ask 请求（accept/decline 回给 daemon，turn 继续）
    pub fn respond_approval(approval_id: &str, accept: bool) -> Result<(), String> {
        let entry = pending_approvals().lock().unwrap().remove(approval_id);
        let Some(pa) = entry else {
            // 已响应或不存在（如 daemon 已退出），静默忽略
            return Ok(());
        };
        let decision = if accept { "accept" } else { "decline" };
        if let Some(client) = Self::global() {
            client.respond(pa.server_id, serde_json::json!({ "decision": decision }));
        } else {
            return Err("app-server 未运行，无法响应审批".to_string());
        }
        Ok(())
    }

    /// 创建会话 thread
    pub fn thread_start(&self, params: serde_json::Value) -> Result<String, String> {
        let resp = self.request("thread/start", Some(params))?;
        let thread_id = resp
            .get("thread")
            .and_then(|t| t.get("id"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("thread/start 无 thread.id: {resp}"))?
            .to_string();
        let model = resp
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let cwd = resp
            .get("cwd")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        self.thread_registry.lock().unwrap().insert(
            thread_id.clone(),
            ThreadMeta { thread_id: thread_id.clone(), model, cwd },
        );
        Ok(thread_id)
    }

    /// 记录 thread 的最近 run_id（事件路由）
    pub fn bind_run(&self, thread_id: &str, run_id: &str) {
        self.run_registry.lock().unwrap().insert(thread_id.to_string(), run_id.to_string());
    }

    /// 发送一轮消息；返回 (turn_id, 关联 thread_id)
    pub fn turn_start(
        &self,
        thread_id: &str,
        input: serde_json::Value,
        extra: Option<serde_json::Value>,
    ) -> Result<String, String> {
        let mut params = serde_json::json!({ "threadId": thread_id, "input": input });
        if let Some(e) = extra {
            if let Some(obj) = e.as_object() {
                for (k, v) in obj {
                    params[k] = v.clone();
                }
            }
        }
        let resp = self.request("turn/start", Some(params))?;
        resp.get("turn")
            .and_then(|t| t.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("turn/start 无 turn.id: {resp}"))
    }

    /// 中断 turn
    pub fn turn_interrupt(&self, thread_id: &str, turn_id: &str) -> Result<(), String> {
        self.request("turn/interrupt", Some(serde_json::json!({
            "threadId": thread_id, "turnId": turn_id
        })))?;
        Ok(())
    }

    /// 动态切换审批模式（thread/settings/update）
    pub fn thread_settings_update(&self, thread_id: &str, patch: serde_json::Value) -> Result<(), String> {
        let mut params = serde_json::json!({ "threadId": thread_id });
        if let Some(obj) = patch.as_object() {
            for (k, v) in obj {
                params[k] = v.clone();
            }
        }
        self.request("thread/settings/update", Some(params))?;
        Ok(())
    }

    /// 统一消息处理
    fn handle_message(
        msg: &serde_json::Value,
        pending: &Mutex<HashMap<i64, mpsc::Sender<serde_json::Value>>>,
        run_registry: &Mutex<HashMap<String, String>>,
        app: &AppHandle,
    ) {
        let has_id = msg.get("id").is_some();
        if has_id {
            if let Some(result) = msg.get("result") {
                let id = msg["id"].as_i64().unwrap_or(-1);
                if let Some(tx) = pending.lock().unwrap().remove(&id) {
                    let _ = tx.send(serde_json::json!({ "result": result.clone() }));
                }
                return;
            }
            if let Some(err) = msg.get("error") {
                let id = msg["id"].as_i64().unwrap_or(-1);
                if let Some(tx) = pending.lock().unwrap().remove(&id) {
                    let _ = tx.send(serde_json::json!({ "error": err.clone() }));
                }
                return;
            }
            // ServerRequest（服务端请求，需客户端响应）
            let id = msg["id"].as_i64().unwrap_or(-1);
            let method = msg["method"].as_str().unwrap_or("").to_string();
            let params = msg.get("params").cloned().unwrap_or(serde_json::Value::Null);
            Self::handle_server_request(id, &method, &params, run_registry, app);
            return;
        }
        // Notification
        let method = msg.get("method").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let params = msg.get("params").cloned().unwrap_or(serde_json::Value::Null);
        Self::handle_notification(&method, &params, run_registry, app);
    }

    /// 服务端请求：审批等。执行前拦截的核心。
    fn handle_server_request(
        id: i64,
        method: &str,
        params: &serde_json::Value,
        run_registry: &Mutex<HashMap<String, String>>,
        app: &AppHandle,
    ) {
        let thread_id = params.get("threadId").and_then(|v| v.as_str()).unwrap_or("");
        let run_id = run_registry.lock().unwrap().get(thread_id).cloned().unwrap_or_default();

            // 审批请求 → 先判断再执行（Claude Code 权限模型：deny/allow/ask）
        if method.contains("requestApproval") || method.contains("Approval") || method == "execCommandApproval" {
            let command = params
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let approval_id = format!("ap-{id}");
            // 规则引擎决策：内置 deny > 用户 deny > 用户 allow > ask（全自动转 allow）
            let decision = SecurityService::decide(&command);
            let desc = if command.is_empty() {
                format!("[app-server] {method} 需要审批")
            } else {
                format!("命令需要审批：{command}")
            };
            let mut item = serde_json::json!({
                "type": "approval_request",
                "id": approval_id,
                "command": command,
                "description": desc,
                "decision": decision.tag(),
            });
            if let RuleDecision::BuiltinDeny(reason) | RuleDecision::UserDeny(reason) = &decision {
                item["reason"] = serde_json::Value::String(reason.clone());
            }
            let _ = app.emit(
                "codex-output",
                CodexEvent {
                    run_id: run_id.clone(),
                    body: CodexEventBody::Json(serde_json::json!({
                        "type": "item.completed",
                        "item": item,
                    })),
                },
            );
            debug_log!("[flydex-appserver] approval id={approval_id} decision={} method={method}", decision.tag());
            match &decision {
                // deny：工具执行前直接拒绝（先判断再执行），并记录审计
                RuleDecision::BuiltinDeny(reason) | RuleDecision::UserDeny(reason) => {
                    Self::respond_global(id, serde_json::json!({ "decision": "decline", "reason": reason }));
                    let _ = SecurityService::add_history(ApprovalRecord {
                        id: approval_id,
                        timestamp: now_secs(),
                        command: command.clone(),
                        approved: false,
                        run_id: run_id.clone(),
                    });
                }
                // allow / 全自动：直接放行
                RuleDecision::UserAllow(_) | RuleDecision::AutoAllow => {
                    Self::respond_global(id, serde_json::json!({ "decision": "accept" }));
                    let _ = SecurityService::add_history(ApprovalRecord {
                        id: approval_id,
                        timestamp: now_secs(),
                        command: command.clone(),
                        approved: true,
                        run_id: run_id.clone(),
                    });
                }
                // ask：挂起等用户决定（不 respond，daemon 挂起当前 turn）
                RuleDecision::Ask => {
                    pending_approvals().lock().unwrap().insert(
                        approval_id,
                        PendingApproval { server_id: id, command: command.clone(), method: method.to_string() },
                    );
                }
            }
            return;
        }

        // 其他服务端请求（elicitation 等）：安全兜底
        let _ = app.emit(
            "codex-output",
            CodexEvent {
                run_id,
                body: CodexEventBody::Json(serde_json::json!({
                    "type": "server.request",
                    "method": method,
                })),
            },
        );
        Self::respond_global(id, serde_json::Value::Null);
    }

    fn respond_global(id: i64, result: serde_json::Value) {
        if let Ok(guard) = slot().lock() {
            if let Some(c) = guard.as_ref() {
                c.respond(id, result);
            }
        }
    }

    /// 服务端通知：转成 exec 风格 JSON 事件推前端
    fn handle_notification(
        method: &str,
        params: &serde_json::Value,
        run_registry: &Mutex<HashMap<String, String>>,
        app: &AppHandle,
    ) {
        let mut thread_id = params
            .get("threadId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if thread_id.is_empty() {
            thread_id = params
                .get("thread")
                .and_then(|t| t.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
        }
        let run_id = run_registry.lock().unwrap().get(&thread_id).cloned().unwrap_or_default();

        let event: Option<serde_json::Value> = match method {
            "thread/started" => Some(serde_json::json!({
                "type": "thread.started",
                "thread_id": thread_id,
            })),
            "turn/started" => Some(serde_json::json!({
                "type": "turn.started",
                "thread_id": thread_id,
            })),
            "item/started" => params
                .get("item")
                .map(|item| serde_json::json!({ "type": "item.started", "item": map_item(item) })),
            "item/completed" => params
                .get("item")
                .map(|item| serde_json::json!({ "type": "item.completed", "item": map_item(item) })),
            "turn/completed" => {
                let usage = params.get("usage").cloned().unwrap_or(serde_json::Value::Null);
                let mut ev = serde_json::json!({ "type": "turn.completed", "thread_id": thread_id });
                if !usage.is_null() {
                    ev["usage"] = usage;
                }
                // 本轮结束 → 通知前端结束 running（codex-done Done）
                let _ = app.emit(
                    "codex-done",
                    CodexEvent { run_id: run_id.clone(), body: CodexEventBody::Done { exit_code: 0 } },
                );
                // 通知 run_command 的 turn 等待者（invoke 在 turn 结束后才返回）
                if let Some(tx) = turn_done().lock().unwrap().remove(&run_id) {
                    let _ = tx.send(());
                }
                Some(ev)
            }
            // 流式增量暂不单独推（前端用 item.completed 完整文本打字机）
            "item/agentMessage/delta" | "item/commandExecution/outputDelta" | "item/plan/delta" => None,
            "error" => params.get("message").map(|m| serde_json::json!({
                "type": "error", "message": m,
            })),
            // warning（MCP 启动/限流类）不映射为前端 error，避免误报
            "warning" => None,
            _ => None,
        };

        if let Some(ev) = event {
            debug_log!("[flydex-appserver] emit codex-output run_id={run_id} event={}", ev);
            let _ = app.emit(
                "codex-output",
                CodexEvent { run_id, body: CodexEventBody::Json(ev) },
            );
        }
    }
}

/// 把 app-server item（camelCase）转成前端兼容的 exec 风格 item（snake_case）
fn map_item(item: &serde_json::Value) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    let raw_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
    // app-server 的 item.type 是 camelCase（agentMessage/commandExecution/...）
    let mapped_type = match raw_type {
        "agentMessage" => "agent_message",
        "commandExecution" => "command_execution",
        "mcpToolCall" => "mcp_tool_call",
        "toolCall" => "tool_call",
        "fileChange" => "file_change",
        "plan" => "plan",
        "reasoning" => "reasoning",
        "userMessage" => "user_message",
        "customToolCall" => "custom_tool_call",
        "collabAgentToolCall" => "collab_agent_tool_call",
        "error" => "error",
        other => other,
    };
    out.insert("type".to_string(), serde_json::Value::String(mapped_type.to_string()));

    if let Some(obj) = item.as_object() {
        for (k, v) in obj {
            // type 已在上方映射为 snake_case，跳过原始 camelCase 避免覆盖
            if k == "type" {
                continue;
            }
            let nk = match k.as_str() {
                "aggregatedOutput" => "aggregated_output",
                "commandActions" => "command_actions",
                "exitCode" => "exit_code",
                "durationMs" => "duration_ms",
                "processId" => "process_id",
                "pluginId" => "plugin_id",
                "scriptPath" => "script_path",
                "memoryCitation" => "memory_citation",
                other => other,
            };
            let nv = if k == "status" {
                match v.as_str() {
                    Some("InProgress") => serde_json::Value::String("in_progress".to_string()),
                    Some("Completed") => serde_json::Value::String("completed".to_string()),
                    Some("Failed") => serde_json::Value::String("failed".to_string()),
                    Some("Declined") => serde_json::Value::String("declined".to_string()),
                    _ => v.clone(),
                }
            } else {
                v.clone()
            };
            out.insert(nk.to_string(), nv);
        }
    }
    serde_json::Value::Object(out)
}
