use serde::{Deserialize, Serialize};

/// Codex 子进程推送到前端的事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum CodexEvent {
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
