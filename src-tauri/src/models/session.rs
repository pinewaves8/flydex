use serde::{Deserialize, Serialize};

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
}

/// 会话元数据（用于列表展示，不包含 messages，加载快）
/// 必须包含 model，否则前端 loadSessions() 重读列表后会话级模型覆盖会丢失（下拉回退全局）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub workdir: String,
    /// 会话级模型覆盖（与 Session.model 一致，供列表直接显示/读取）
    #[serde(default)]
    pub model: Option<String>,
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
            model: s.model.clone(),
            created_at: s.created_at,
            updated_at: s.updated_at,
        }
    }
}
