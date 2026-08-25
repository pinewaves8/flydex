use serde::{Deserialize, Serialize};

/// codex exec --json 输出的 JSONL 事件
///
/// 每一行是一个 JSON 对象，type 字段标识事件类型。
/// 注意：type 值带点号（如 "thread.started"），不能用 rename_all，必须显式 rename。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CodexJsonEvent {
    /// 会话开始
    #[serde(rename = "thread.started")]
    ThreadStarted {
        #[serde(rename = "thread_id")]
        thread_id: String,
    },
    /// 一轮对话开始
    #[serde(rename = "turn.started")]
    TurnStarted,
    /// 某个项目完成（消息、工具调用、错误等）
    #[serde(rename = "item.completed")]
    ItemCompleted {
        item: CodexItem,
    },
    /// 一轮对话完成
    #[serde(rename = "turn.completed")]
    TurnCompleted {
        usage: Option<CodexUsage>,
    },
}

/// codex 输出的项目（消息、工具调用、错误等）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CodexItem {
    /// 错误信息
    Error {
        id: String,
        message: String,
    },
    /// Agent 回复消息
    AgentMessage {
        id: String,
        text: String,
    },
    /// 工具调用
    ToolCall {
        id: String,
        name: String,
        arguments: Option<serde_json::Value>,
        status: Option<String>,
    },
    /// 审批请求
    ApprovalRequest {
        id: String,
        command: Option<String>,
        description: Option<String>,
    },
    /// 其他未识别的项目类型（兜底）
    #[serde(untagged)]
    Other(serde_json::Value),
}

/// token 使用统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexUsage {
    pub input_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub cache_write_input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_output_tokens: Option<u64>,
}

impl CodexJsonEvent {
    /// 从 JSON 字符串解析事件
    pub fn from_json(line: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(line)
    }
}
