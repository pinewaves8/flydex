use serde::{Deserialize, Serialize};

/// Codex 子进程推送到前端的事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum CodexEvent {
    /// stdout 输出一行
    Output { text: String },
    /// stderr 输出一行
    Error { message: String },
    /// 进程结束
    Done { exit_code: i32 },
}
