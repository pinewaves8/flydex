use serde::{Deserialize, Serialize};

/// 对话会话数据模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub workdir: String,
    pub thread_id: Option<String>,
    /// 消息列表，用 serde_json::Value 存储，避免 Rust 端依赖前端类型定义
    pub messages: Vec<serde_json::Value>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 会话元数据（用于列表展示，不包含 messages，加载快）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub workdir: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<&Session> for SessionMeta {
    fn from(s: &Session) -> Self {
        SessionMeta {
            id: s.id.clone(),
            project_id: s.project_id.clone(),
            title: s.title.clone(),
            workdir: s.workdir.clone(),
            created_at: s.created_at,
            updated_at: s.updated_at,
        }
    }
}
