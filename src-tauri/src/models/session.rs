use serde::{Deserialize, Serialize};

/// Fork 来源信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForkedFrom {
    pub session_id: String,
    /// 从原会话的第几条消息开始（0-based，含）
    pub message_index: usize,
}

/// 对话会话数据模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub workdir: String,
    pub thread_id: Option<String>,
    /// 会话级模型覆盖（None 时用全局默认模型）
    #[serde(default)]
    pub model: Option<String>,
    /// 消息列表，用 serde_json::Value 存储，避免 Rust 端依赖前端类型定义
    pub messages: Vec<serde_json::Value>,
    pub created_at: i64,
    pub updated_at: i64,
    /// 软删除时间戳（None = 未删除）
    #[serde(default)]
    pub deleted_at: Option<i64>,
    /// Fork 来源
    #[serde(default)]
    pub forked_from: Option<ForkedFrom>,
}

/// 会话元数据（用于列表展示，不包含 messages）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub workdir: String,
    /// 会话级模型覆盖
    #[serde(default)]
    pub model: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// 消息数量（列表展示用）
    #[serde(default)]
    pub message_count: usize,
    /// 软删除时间戳
    #[serde(default)]
    pub deleted_at: Option<i64>,
    /// Fork 来源
    #[serde(default)]
    pub forked_from: Option<ForkedFrom>,
}

impl From<&Session> for SessionMeta {
    fn from(s: &Session) -> Self {
        SessionMeta {
            id: s.id.clone(),
            project_id: s.project_id.clone(),
            title: s.title.clone(),
            workdir: s.workdir.clone(),
            model: s.model.clone(),
            created_at: s.created_at,
            updated_at: s.updated_at,
            message_count: s.messages.len(),
            deleted_at: s.deleted_at,
            forked_from: s.forked_from.clone(),
        }
    }
}

/// 搜索结果（带匹配片段）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSearchHit {
    pub session: SessionMeta,
    /// 匹配的字段（title 或 content）
    pub match_field: String,
    /// 匹配的片段（最多 120 字符）
    pub snippet: String,
}