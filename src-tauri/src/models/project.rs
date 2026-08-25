use serde::{Deserialize, Serialize};

/// 项目数据模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub platform: String,
    pub created_at: i64,
    pub updated_at: i64,
}
