use serde::{Deserialize, Serialize};

/// 任务状态（Claude Code 对齐：todo / in_progress / done / cancelled）
pub mod status {
    pub const TODO: &str = "todo";
    pub const IN_PROGRESS: &str = "in_progress";
    pub const DONE: &str = "done";
    pub const CANCELLED: &str = "cancelled";

    pub fn is_valid(s: &str) -> bool {
        matches!(s, TODO | IN_PROGRESS | DONE | CANCELLED)
    }
}

/// 任务优先级
pub mod priority {
    pub const HIGH: &str = "high";
    pub const MEDIUM: &str = "medium";
    pub const LOW: &str = "low";

    pub fn is_valid(s: &str) -> bool {
        matches!(s, HIGH | MEDIUM | LOW)
    }
}

/// 持久化任务（7.4.2 Tasks API，与 Claude Code /tasks 对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    /// todo / in_progress / done / cancelled
    #[serde(default = "default_status")]
    pub status: String,
    /// high / medium / low
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default)]
    pub labels: Vec<String>,
    /// 关联项目（可选）
    #[serde(default, alias = "project_id")]
    pub project_id: Option<String>,
    /// 关联会话（可选）
    #[serde(default, alias = "session_id")]
    pub session_id: Option<String>,
    #[serde(default, alias = "created_at")]
    pub created_at: i64,
    #[serde(default, alias = "updated_at")]
    pub updated_at: i64,
}

fn default_status() -> String {
    status::TODO.to_string()
}

fn default_priority() -> String {
    priority::MEDIUM.to_string()
}

impl Task {
    /// 构造新任务（id/时间由服务层生成）
    pub fn new(
        id: String,
        title: String,
        description: String,
        priority: String,
        project_id: Option<String>,
        session_id: Option<String>,
        labels: Vec<String>,
        created_at: i64,
    ) -> Self {
        Self {
            id,
            title,
            description,
            status: status::TODO.to_string(),
            priority,
            labels,
            project_id,
            session_id,
            created_at,
            updated_at: created_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_old_snake_case_task() {
        let old = r#"{"id":"t1","title":"x","description":"","status":"todo","priority":"medium","labels":[],"project_id":"p1","session_id":null,"created_at":1,"updated_at":2}"#;
        let t: Task = serde_json::from_str(old).unwrap();
        assert_eq!(t.project_id.as_deref(), Some("p1"));
        assert_eq!(t.updated_at, 2);
    }

    #[test]
    fn serialize_camel_case_task() {
        let t = Task::new(
            "t1".into(),
            "x".into(),
            "d".into(),
            priority::HIGH.into(),
            Some("p1".into()),
            None,
            vec!["a".into()],
            1,
        );
        let j = serde_json::to_string(&t).unwrap();
        assert!(j.contains("\"projectId\""), "missing projectId: {j}");
        assert!(j.contains("\"status\":\"todo\""));
        assert!(!j.contains("project_id"));
    }

    #[test]
    fn status_and_priority_validity() {
        assert!(status::is_valid(status::DONE));
        assert!(!status::is_valid("bogus"));
        assert!(priority::is_valid(priority::LOW));
        assert!(!priority::is_valid("urgent"));
    }
}
