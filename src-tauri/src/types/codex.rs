use serde::{Deserialize, Serialize};

/// Codex 子进程推送到前端的事件（含 run_id，供多 run 并行时区分路由）
///
/// 序列化格式：`{"run_id":"...","type":"Started","data":{...}}`
/// run_id 平铺在顶层，body 保持原 tag/content 结构，前端解析兼容。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexEvent {
    /// 所属运行 ID（子代理并行时用于路由到对应面板）
    pub run_id: String,
    #[serde(flatten)]
    pub body: CodexEventBody,
}

/// 事件体
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum CodexEventBody {
    /// 进程已启动
    Started { pid: u32 },
    /// stdout 纯文本输出（JSONL 解析失败的行）
    Output { text: String },
    /// stderr 输出
    Error { message: String },
    /// 解析成功的 JSONL 结构化事件（元组变体，避免与 content="data" 嵌套）
    Json(serde_json::Value),
    /// 进程结束
    Done { exit_code: i32 },
}
