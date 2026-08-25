use std::fs;
use std::path::PathBuf;

use crate::models::project::Project;
use crate::models::session::{Session, SessionMeta};

/// 存储管理服务
///
/// 负责项目和会话的持久化，文件存储在 ~/.flydex/ 目录下。
pub struct Storage;

impl Storage {
    /// 获取应用数据目录
    pub fn app_dir() -> PathBuf {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        home.join(".flydex")
    }

    /// 会话存储目录
    fn sessions_dir() -> PathBuf {
        Self::app_dir().join("sessions")
    }

    /// 项目列表文件路径
    fn projects_file() -> PathBuf {
        Self::app_dir().join("projects.json")
    }

    /// 确保目录存在
    fn ensure_dirs() -> std::io::Result<()> {
        fs::create_dir_all(Self::sessions_dir())?;
        Ok(())
    }

    // ── 项目管理 ──

    /// 读取所有项目
    pub fn list_projects() -> Vec<Project> {
        let path = Self::projects_file();
        if !path.exists() {
            return Vec::new();
        }
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    }

    /// 保存项目列表
    pub fn save_projects(projects: &[Project]) -> std::io::Result<()> {
        Self::ensure_dirs()?;
        let content = serde_json::to_string_pretty(projects).unwrap_or_default();
        fs::write(Self::projects_file(), content)
    }

    /// 创建或更新项目
    pub fn upsert_project(project: Project) -> std::io::Result<()> {
        let mut projects = Self::list_projects();
        if let Some(existing) = projects.iter_mut().find(|p| p.id == project.id) {
            *existing = project;
        } else {
            projects.push(project);
        }
        Self::save_projects(&projects)
    }

    /// 删除项目
    pub fn delete_project(project_id: &str) -> std::io::Result<()> {
        let projects = Self::list_projects();
        let filtered: Vec<Project> = projects.into_iter().filter(|p| p.id != project_id).collect();
        Self::save_projects(&filtered)?;
        // 同时删除该项目下的所有会话
        let sessions = Self::list_sessions(Some(project_id));
        for s in sessions {
            let _ = Self::delete_session(&s.id);
        }
        Ok(())
    }

    // ── 会话管理 ──

    /// 会话文件路径
    fn session_file(session_id: &str) -> PathBuf {
        Self::sessions_dir().join(format!("{}.json", session_id))
    }

    /// 列出会话元数据
    ///
    /// 如果指定 project_id，只返回该项目下的会话；否则返回所有会话。
    pub fn list_sessions(project_id: Option<&str>) -> Vec<SessionMeta> {
        let dir = Self::sessions_dir();
        if !dir.exists() {
            return Vec::new();
        }
        let mut sessions: Vec<SessionMeta> = Vec::new();
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(session) = serde_json::from_str::<Session>(&content) {
                        if let Some(pid) = project_id {
                            if session.project_id != pid {
                                continue;
                            }
                        }
                        sessions.push(SessionMeta::from(&session));
                    }
                }
            }
        }
        // 按更新时间倒序
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        sessions
    }

    /// 加载会话详情
    pub fn load_session(session_id: &str) -> Option<Session> {
        let path = Self::session_file(session_id);
        if !path.exists() {
            return None;
        }
        let content = fs::read_to_string(&path).ok()?;
        serde_json::from_str(&content).ok()
    }

    /// 保存会话
    pub fn save_session(session: &Session) -> std::io::Result<()> {
        Self::ensure_dirs()?;
        let content = serde_json::to_string_pretty(session).unwrap_or_default();
        fs::write(Self::session_file(&session.id), content)
    }

    /// 删除会话
    pub fn delete_session(session_id: &str) -> std::io::Result<()> {
        let path = Self::session_file(session_id);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }
}
