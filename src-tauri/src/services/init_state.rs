//! 项目 init 流程状态管理
//!
//! 持久化到 `<workdir>/.flydex/init-state.json`
//! 用于 /init 中断/恢复,避免用户切换项目后丢失进度。

use serde::{Deserialize, Serialize};
use std::path::Path;

/// Init 流程状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InitStep {
    /// 还没开始 init
    Idle,
    /// 已扫描,等待用户选模式
    Scanned,
    /// 正在收集需求(引导对话中)
    CollectingRequirements,
    /// 正在收集技术栈
    CollectingTechSpec,
    /// 需求/技术文档齐全,等待生成 AGENTS.md
    ReadyToGenerate,
    /// Init 完成
    Done,
}

/// 持久化的状态数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitStateData {
    pub step: InitStep,
    /// 扫描结果(workdir / scenario)
    pub workdir: String,
    pub scenario: String,
    /// 已写入的文档路径(用于恢复时跳过重复写入)
    pub written_files: Vec<String>,
    /// 上次更新时间(ISO 字符串)
    pub updated_at: String,
}

impl InitStateData {
    pub fn new(workdir: &str, scenario: &str) -> Self {
        Self {
            step: InitStep::Scanned,
            workdir: workdir.to_string(),
            scenario: scenario.to_string(),
            written_files: Vec::new(),
            updated_at: now_iso(),
        }
    }

    pub fn state_file(workdir: &str) -> std::path::PathBuf {
        Path::new(workdir).join(".flydex").join("init-state.json")
    }

    /// 加载状态(不存在返回 None)
    pub fn load(workdir: &str) -> Option<Self> {
        let path = Self::state_file(workdir);
        let content = std::fs::read_to_string(&path).ok()?;
        serde_json::from_str(&content).ok()
    }

    /// 保存状态到 `<workdir>/.flydex/init-state.json`
    pub fn save(&self) -> Result<(), String> {
        let path = Self::state_file(&self.workdir);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建 .flydex 目录失败: {}", e))?;
        }
        let content =
            serde_json::to_string_pretty(self).map_err(|e| format!("序列化失败: {}", e))?;
        std::fs::write(&path, content).map_err(|e| format!("写入失败: {}", e))
    }

    /// 删除状态文件(init 完成或用户取消时调用)
    pub fn clear(workdir: &str) {
        let path = Self::state_file(workdir);
        let _ = std::fs::remove_file(&path);
    }
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 简化:用 unix 时间戳(秒),后续可换 chrono
    format!("{}", secs)
}

pub struct InitStateService;

impl InitStateService {
    pub fn get(workdir: &str) -> Option<InitStateData> {
        InitStateData::load(workdir)
    }

    pub fn set(workdir: &str, scenario: &str, step: InitStep) -> Result<InitStateData, String> {
        let mut data =
            InitStateData::load(workdir).unwrap_or_else(|| InitStateData::new(workdir, scenario));
        data.scenario = scenario.to_string();
        data.step = step;
        data.updated_at = now_iso();
        data.save()?;
        Ok(data)
    }

    pub fn clear(workdir: &str) {
        InitStateData::clear(workdir);
    }

    pub fn append_written_file(workdir: &str, path: &str) -> Result<(), String> {
        let mut data =
            InitStateData::load(workdir).ok_or_else(|| format!("状态不存在: {}", workdir))?;
        if !data.written_files.contains(&path.to_string()) {
            data.written_files.push(path.to_string());
            data.updated_at = now_iso();
            data.save()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "flydex_initstate_test_{}_{}",
            tag,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn save_and_load() {
        let dir = temp_dir("save");
        let s = InitStateService::set(dir.to_str().unwrap(), "B", InitStep::CollectingRequirements)
            .unwrap();
        assert_eq!(s.step, InitStep::CollectingRequirements);
        assert_eq!(s.scenario, "B");

        let loaded = InitStateService::get(dir.to_str().unwrap()).unwrap();
        assert_eq!(loaded.step, InitStep::CollectingRequirements);
    }

    #[test]
    fn clear_removes_file() {
        let dir = temp_dir("clear");
        InitStateService::set(dir.to_str().unwrap(), "A", InitStep::Scanned).unwrap();
        assert!(InitStateData::state_file(dir.to_str().unwrap()).exists());
        InitStateService::clear(dir.to_str().unwrap());
        assert!(!InitStateData::state_file(dir.to_str().unwrap()).exists());
    }

    #[test]
    fn append_written_file_dedup() {
        let dir = temp_dir("append");
        InitStateService::set(dir.to_str().unwrap(), "D", InitStep::Idle).unwrap();
        InitStateService::append_written_file(dir.to_str().unwrap(), "requirements.md").unwrap();
        InitStateService::append_written_file(dir.to_str().unwrap(), "requirements.md").unwrap();
        InitStateService::append_written_file(dir.to_str().unwrap(), "tech-spec.md").unwrap();
        let loaded = InitStateService::get(dir.to_str().unwrap()).unwrap();
        assert_eq!(
            loaded.written_files,
            vec!["requirements.md", "tech-spec.md"]
        );
    }

    #[test]
    fn get_returns_none_when_no_file() {
        let dir = temp_dir("none");
        assert!(InitStateService::get(dir.to_str().unwrap()).is_none());
    }
}
