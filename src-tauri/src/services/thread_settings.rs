//! 会话级 UI 偏好
//!
//! codex 的 `Thread` 里**没有**这些字段,它们也不影响 codex 的行为 ——
//! 纯属 Flydex 的展示偏好,所以放在 Flydex 自己的目录里,而不是塞进 codex 的状态库。
//!
//! 目前只有一项:会话级模型覆盖(`None` = 跟随全局默认)。模型本身是每轮
//! `thread/resume` 的 `config` 下发给 codex 的(见 `model.rs`),这里只负责**记住用户的
//! 选择**,让重启后仍然生效。
//!
//! 文件:`~/.flydex/thread_settings.json`

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::services::storage::Storage;

const FILE: &str = "thread_settings.json";

/// 保留的会话数上限 —— 只是个 UI 偏好,不值得无限增长
const MAX_ENTRIES: usize = 500;

/// 单个会话的偏好
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSettings {
    /// 会话级模型覆盖;`None` = 跟随全局默认
    #[serde(default)]
    pub model: Option<String>,
    /// 最后修改时间(毫秒),既给前端用,也用作淘汰时的排序键
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsFile {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    threads: HashMap<String, ThreadSettings>,
}

fn default_version() -> u32 {
    1
}

/// 手写 `Default`:与 serde 的 `default_version()` 保持一致,
/// 否则新建文件会写成 `version: 0`(与 `project_map` 同款陷阱)。
impl Default for SettingsFile {
    fn default() -> Self {
        Self {
            version: default_version(),
            threads: HashMap::new(),
        }
    }
}

impl SettingsFile {
    fn path() -> Option<PathBuf> {
        Some(Storage::app_dir().join(FILE))
    }

    fn load() -> Self {
        let Some(p) = Self::path() else {
            return Self::default();
        };
        std::fs::read_to_string(p)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    fn save(&self) -> Result<(), String> {
        let Some(p) = Self::path() else {
            return Err("无法定位 ~/.flydex 目录".into());
        };
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&p, json).map_err(|e| format!("写入会话偏好失败: {e}"))
    }

    /// 超过上限时按 `updatedAt` 淘汰最旧的
    fn prune(&mut self) {
        if self.threads.len() <= MAX_ENTRIES {
            return;
        }
        let mut by_age: Vec<(String, i64)> = self
            .threads
            .iter()
            .map(|(k, v)| (k.clone(), v.updated_at))
            .collect();
        by_age.sort_by_key(|(_, ts)| *ts);
        for (id, _) in by_age.into_iter().take(self.threads.len() - MAX_ENTRIES) {
            self.threads.remove(&id);
        }
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct ThreadSettingsService;

impl ThreadSettingsService {
    /// 读某个会话的偏好(没有则返回默认值,不报错)
    pub fn get(thread_id: &str) -> ThreadSettings {
        SettingsFile::load()
            .threads
            .get(thread_id)
            .cloned()
            .unwrap_or_default()
    }

    /// 设置会话级模型覆盖(`None` = 跟随全局)
    ///
    /// 存 `None` 时**保留条目**(只清空 model),这样切换语义清晰:
    /// `None` 是"显式选择跟随全局",与"从没设过"行为一致。
    pub fn set_model(thread_id: &str, model: Option<String>) -> Result<(), String> {
        if thread_id.trim().is_empty() {
            return Err("thread id 为空".into());
        }
        let mut file = SettingsFile::load();
        let entry = file.threads.entry(thread_id.to_string()).or_default();
        entry.model = model;
        entry.updated_at = now_ms();
        file.prune();
        file.save()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_round_trips_and_defaults_version() {
        let mut f = SettingsFile::default();
        assert_eq!(f.version, 1);
        f.threads.insert(
            "t1".into(),
            ThreadSettings {
                model: Some("gpt-5".into()),
                updated_at: 42,
            },
        );
        let json = serde_json::to_string(&f).unwrap();
        let back: SettingsFile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.threads.get("t1").unwrap().model.as_deref(), Some("gpt-5"));
        assert_eq!(back.version, 1);
    }

    #[test]
    fn empty_or_partial_json_parses() {
        // 文件缺失/被写坏时不能让启动崩
        let f: SettingsFile = serde_json::from_str("{}").unwrap();
        assert_eq!(f.version, 1);
        assert!(f.threads.is_empty());
        // 只给了部分字段的条目也要能读
        let g: SettingsFile = serde_json::from_str(r#"{"threads":{"t1":{}}}"#).unwrap();
        let t1 = g.threads.get("t1").unwrap();
        assert_eq!(t1.model, None);
        assert_eq!(t1.updated_at, 0);
    }

    #[test]
    fn prune_keeps_newest_up_to_cap() {
        let mut f = SettingsFile::default();
        for i in 0..(MAX_ENTRIES + 10) {
            f.threads.insert(
                format!("t{i}"),
                ThreadSettings {
                    model: None,
                    // 越靠后的越新
                    updated_at: i as i64,
                },
            );
        }
        f.prune();
        assert_eq!(f.threads.len(), MAX_ENTRIES);
        // 最旧的 10 个被淘汰
        assert!(!f.threads.contains_key("t0"));
        assert_eq!(f.threads.get("t9").map(|_| ()), None);
        assert!(f.threads.contains_key(&format!("t{}", MAX_ENTRIES + 9)));
    }
}
