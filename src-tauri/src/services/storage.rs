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

    /// 日志文件(与 security.json 等同目录)
    ///
    /// 各处的调试日志都走这里 —— 此前有四份**硬编码的绝对路径**
    /// (`C:\llmlydex\logs\...`),换台机器目录不存在,日志会静默写不进去。
    pub fn log_file(name: &str) -> PathBuf {
        Self::app_dir().join("logs").join(name)
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

    pub fn list_projects() -> Vec<Project> {
        let path = Self::projects_file();
        if !path.exists() {
            return Vec::new();
        }
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    }

    pub fn save_projects(projects: &[Project]) -> std::io::Result<()> {
        Self::ensure_dirs()?;
        let content = serde_json::to_string_pretty(projects).unwrap_or_default();
        fs::write(Self::projects_file(), content)
    }

    pub fn upsert_project(project: Project) -> std::io::Result<()> {
        let mut projects = Self::list_projects();
        if let Some(existing) = projects.iter_mut().find(|p| p.id == project.id) {
            *existing = project;
        } else {
            projects.push(project);
        }
        Self::save_projects(&projects)
    }

    /// 删除项目条目
    ///
    /// **刻意不删 `~/.flydex/sessions/` 下的旧会话文件** —— 自会话迁移到 codex 后,
    /// 那些文件是「没有 threadId 的老会话」的唯一副本,属只读归档;删一个项目条目
    /// 不该把历史对话一起销毁。(codex 侧的会话由 `thread_cascade` 负责。)
    pub fn delete_project(project_id: &str) -> std::io::Result<()> {
        let projects = Self::list_projects();
        let filtered: Vec<Project> = projects.into_iter().filter(|p| p.id != project_id).collect();
        Self::save_projects(&filtered)
    }

    // ── 会话管理（基础 CRUD） ──

    fn session_file(session_id: &str) -> PathBuf {
        Self::sessions_dir().join(format!("{}.json", session_id))
    }


    /// 列出会话（仅未删除的）
    pub fn list_sessions(project_id: Option<&str>) -> Vec<SessionMeta> {
        Self::list_sessions_internal(project_id)
    }

    /// 读出旧会话文件里已有的 `(codex threadId, flydex projectId)` 对应关系。
    ///
    /// 仅供一次性把已有 thread 归到 codex project 时使用(见 `project_map::backfill_threads`)。
    /// **纯只读** —— 这些文件是旧会话只读归档的唯一副本,不得修改。
    pub fn list_session_thread_projects() -> Vec<(String, String)> {
        let dir = Self::sessions_dir();
        if !dir.exists() {
            return Vec::new();
        }
        let mut out = Vec::new();
        let Ok(entries) = fs::read_dir(&dir) else {
            return out;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) else {
                continue;
            };
            // 兼容 camelCase 与旧 snake_case 两种键名
            let get = |k: &str, alt: &str| {
                v.get(k)
                    .or_else(|| v.get(alt))
                    .and_then(|x| x.as_str())
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            };
            if let (Some(tid), Some(pid)) = (
                get("threadId", "thread_id"),
                get("projectId", "project_id"),
            ) {
                out.push((tid, pid));
            }
        }
        out
    }


    fn list_sessions_internal(project_id: Option<&str>) -> Vec<SessionMeta> {
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

    pub fn load_session(session_id: &str) -> Option<Session> {
        let path = Self::session_file(session_id);
        if !path.exists() {
            return None;
        }
        let content = fs::read_to_string(&path).ok()?;
        serde_json::from_str(&content).ok()
    }




    // ── 导出 ──

    /// 导出会话为 JSON 字符串
    pub fn export_json(session_id: &str) -> Result<String, String> {
        let session = Self::load_session(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        serde_json::to_string_pretty(&session).map_err(|e| e.to_string())
    }

    /// 导出会话为 Markdown
    pub fn export_markdown(session_id: &str) -> Result<String, String> {
        let session = Self::load_session(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        let mut out = String::new();
        out.push_str(&format!("# {}\n\n", session.title));
        out.push_str(&format!(
            "- **会话 ID**: `{}`\n- **工作目录**: `{}`\n- **创建时间**: {}\n- **更新时间**: {}\n- **消息数**: {}\n\n",
            session.id,
            session.workdir,
            format_ts(session.created_at),
            format_ts(session.updated_at),
            session.messages.len()
        ));
        if let Some(model) = &session.model {
            out.push_str(&format!("- **模型**: `{}`\n", model));
        }
        if let Some(ff) = &session.forked_from {
            out.push_str(&format!(
                "- **Fork 自**: `{}` 的第 {} 条消息\n",
                ff.session_id, ff.message_index
            ));
        }
        out.push_str("---\n\n");
        for (i, msg) in session.messages.iter().enumerate() {
            let kind = msg
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            out.push_str(&format!(
                "## {} ({} · {})\n\n",
                i + 1,
                kind,
                format_ts(i64_from_msg(msg, "timestamp"))
            ));
            let content = msg
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            out.push_str(content);
            if let Some(tool) = msg.get("toolName").and_then(|v| v.as_str()) {
                out.push_str(&format!("\n\n_Tool: `{}`_\n", tool));
            }
            out.push_str("\n\n");
        }
        Ok(out)
    }
}

/// 提取消息的纯文本内容（用于搜索）

/// 在文本中围绕查询词生成片段（最多 max_chars 字符）



fn format_ts(ts: i64) -> String {
    // 简化：秒级 ISO（无 chrono 依赖）
    chrono_iso(ts / 1000)
}

/// 极简 ISO 时间格式化（避免引入 chrono 依赖）
fn chrono_iso(secs: i64) -> String {
    // 简化为秒级 UTC（精度足够，不需要复杂日期运算）
    let days_since_epoch = secs / 86400;
    let secs_today = secs % 86400;
    let h = secs_today / 3600;
    let m = (secs_today % 3600) / 60;
    let s = secs_today % 60;
    // 估算年/月/日（近似算法：从 1970-01-01 起算）
    let (y, mo, d) = days_to_ymd(days_since_epoch);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, mo, d, h, m, s
    )
}

fn days_to_ymd(days: i64) -> (i64, u32, u32) {
    // 1970-01-01 起算的简单日期换算
    let mut y = 1970;
    let mut d = days;
    loop {
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        let days_in_year = if leap { 366 } else { 365 };
        if d < days_in_year {
            break;
        }
        d -= days_in_year;
        y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let month_days = if leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut mo = 0;
    let mut day = d;
    for (i, &md) in month_days.iter().enumerate() {
        if day < md {
            mo = i;
            break;
        }
        day -= md;
    }
    (y, (mo + 1) as u32, (day + 1) as u32)
}

fn i64_from_msg(msg: &serde_json::Value, key: &str) -> i64 {
    msg.get(key)
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
}