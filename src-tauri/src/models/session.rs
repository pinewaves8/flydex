use serde::{Deserialize, Serialize};

/// Fork 来源信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkedFrom {
    #[serde(alias = "session_id")]
    pub session_id: String,
    /// 从原会话的第几条消息开始（0-based，含）
    #[serde(alias = "message_index")]
    pub message_index: usize,
}

/// 对话会话数据模型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    #[serde(alias = "project_id")]
    pub project_id: String,
    pub title: String,
    pub workdir: String,
    #[serde(alias = "thread_id")]
    pub thread_id: Option<String>,
    /// 会话级模型覆盖（None 时用全局默认模型）
    #[serde(default)]
    pub model: Option<String>,
    /// 消息列表，用 serde_json::Value 存储，避免 Rust 端依赖前端类型定义
    pub messages: Vec<serde_json::Value>,
    #[serde(alias = "created_at")]
    pub created_at: i64,
    #[serde(alias = "updated_at")]
    pub updated_at: i64,
    /// 软删除时间戳（None = 未删除）
    #[serde(default, alias = "deleted_at")]
    pub deleted_at: Option<i64>,
    /// Fork 来源
    #[serde(default, alias = "forked_from")]
    pub forked_from: Option<ForkedFrom>,
}

/// 会话元数据（用于列表展示，不包含 messages）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    #[serde(alias = "project_id")]
    pub project_id: String,
    pub title: String,
    pub workdir: String,
    /// 会话级模型覆盖
    #[serde(default)]
    pub model: Option<String>,
    /// 该旧会话对应的 codex threadId(迁移时写入)
    ///
    /// 有值 = 内容已经能从 codex 侧读到,侧边栏按线程展示,不必再作为「旧会话」列出;
    /// 无值 = 迁移前的老会话,只能只读渲染(见 P8 的只读归档)。
    #[serde(default, alias = "thread_id")]
    pub thread_id: Option<String>,
    #[serde(alias = "created_at")]
    pub created_at: i64,
    #[serde(alias = "updated_at")]
    pub updated_at: i64,
    /// 消息数量（列表展示用）
    #[serde(default, alias = "message_count")]
    pub message_count: usize,
    /// 软删除时间戳
    #[serde(default, alias = "deleted_at")]
    pub deleted_at: Option<i64>,
    /// Fork 来源
    #[serde(default, alias = "forked_from")]
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
            thread_id: s.thread_id.clone(),
            created_at: s.created_at,
            updated_at: s.updated_at,
            message_count: s.messages.len(),
            deleted_at: s.deleted_at,
            forked_from: s.forked_from.clone(),
        }
    }
}



#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_old_snake_case_session() {
        let old = r#"{"id":"s1","project_id":"p1","title":"t","workdir":"w","thread_id":"th1","model":null,"messages":[],"created_at":1,"updated_at":2,"deleted_at":null,"forked_from":null}"#;
        let s: Session = serde_json::from_str(old).unwrap();
        assert_eq!(s.thread_id.as_deref(), Some("th1"));
        assert_eq!(s.project_id, "p1");
        assert_eq!(s.updated_at, 2);
    }

    #[test]
    fn serialize_camel_case_session() {
        let s = Session {
            id: "s1".into(), project_id: "p1".into(), title: "t".into(), workdir: "w".into(),
            thread_id: Some("th1".into()), model: None, messages: vec![],
            created_at: 1, updated_at: 2, deleted_at: None, forked_from: None,
        };
        let j = serde_json::to_string(&s).unwrap();
        assert!(j.contains("\"threadId\""), "missing threadId: {j}");
        assert!(!j.contains("thread_id"), "still snake: {j}");
    }
}
