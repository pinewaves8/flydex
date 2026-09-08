use std::fs;
use std::path::PathBuf;

use crate::models::project::Project;
use crate::models::session::{ForkedFrom, Session, SessionMeta, SessionSearchHit};

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

    pub fn delete_project(project_id: &str) -> std::io::Result<()> {
        let projects = Self::list_projects();
        let filtered: Vec<Project> = projects.into_iter().filter(|p| p.id != project_id).collect();
        Self::save_projects(&filtered)?;
        let sessions = Self::list_sessions_internal(Some(project_id), false);
        for s in sessions {
            let _ = Self::delete_session_file(&s.id);
        }
        Ok(())
    }

    // ── 会话管理（基础 CRUD） ──

    fn session_file(session_id: &str) -> PathBuf {
        Self::sessions_dir().join(format!("{}.json", session_id))
    }

    fn delete_session_file(session_id: &str) -> std::io::Result<()> {
        let path = Self::session_file(session_id);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    /// 列出会话（仅未删除的）
    pub fn list_sessions(project_id: Option<&str>) -> Vec<SessionMeta> {
        Self::list_sessions_internal(project_id, false)
    }

    /// 列出回收站（仅已删除的）
    pub fn list_trashed_sessions() -> Vec<SessionMeta> {
        Self::list_sessions_internal(None, true)
    }

    fn list_sessions_internal(project_id: Option<&str>, only_trashed: bool) -> Vec<SessionMeta> {
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
                        let is_trashed = session.deleted_at.is_some();
                        if only_trashed != is_trashed {
                            continue;
                        }
                        sessions.push(SessionMeta::from(&session));
                    }
                }
            }
        }
        // 回收站按删除时间倒序，其他按更新时间倒序
        if only_trashed {
            sessions.sort_by(|x, y| {
                y.deleted_at
                    .unwrap_or(0)
                    .cmp(&x.deleted_at.unwrap_or(0))
            });
        } else {
            sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        }
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

    pub fn save_session(session: &Session) -> std::io::Result<()> {
        Self::ensure_dirs()?;
        let content = serde_json::to_string_pretty(session).unwrap_or_default();
        // 调试：记录 autosave 链路（保存的会话 id / thread / 消息数）
        let thread = session.thread_id.clone().unwrap_or_default();
        let n = session.messages.len();
        eprintln!("[flydex] save_session id={} thread_id={} messages={}", session.id, thread, n);
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(r"C:\llm\flydex\logs\flydex-appserver.log")
        {
            use std::io::Write;
            let _ = writeln!(f, "[flydex] save_session id={} thread_id={} messages={}", session.id, thread, n);
        }
        // 原子写入：先写 .tmp 再 rename，避免写入过程中崩溃导致文件损坏
        let final_path = Self::session_file(&session.id);
        let tmp_path = final_path.with_extension("json.tmp");
        match fs::write(&tmp_path, &content) {
            Ok(_) => {
                // Windows 上 rename 不覆盖已有文件，需要先 remove
                if final_path.exists() {
                    let _ = fs::remove_file(&final_path);
                }
                fs::rename(&tmp_path, &final_path)
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp_path);
                Err(e)
            }
        }
    }

    /// 永久删除会话文件
    pub fn delete_session(session_id: &str) -> std::io::Result<()> {
        Self::delete_session_file(session_id)
    }

    // ── 软删除（回收站） ──

    /// 把会话移到回收站（写入 deleted_at）
    pub fn trash_session(session_id: &str) -> Result<(), String> {
        let mut session = Self::load_session(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        session.deleted_at = Some(now_ms());
        session.updated_at = session.deleted_at.unwrap_or(now_ms());
        Self::save_session(&session).map_err(|e| e.to_string())
    }

    /// 从回收站恢复会话
    pub fn restore_session(session_id: &str) -> Result<(), String> {
        let mut session = Self::load_session(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        session.deleted_at = None;
        session.updated_at = now_ms();
        Self::save_session(&session).map_err(|e| e.to_string())
    }

    // ── Fork ──

    /// 从指定消息索引 fork 一个新会话
    pub fn fork_session(
        session_id: &str,
        message_index: usize,
    ) -> Result<Session, String> {
        let original = Self::load_session(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        if message_index >= original.messages.len() {
            return Err(format!(
                "message_index {} out of bounds (session has {} messages)",
                message_index,
                original.messages.len()
            ));
        }
        // 截取到指定位置（含）
        let mut messages = original.messages.clone();
        messages.truncate(message_index + 1);

        let now = now_ms();
        let new_session = Session {
            id: format!("sess_{}", uuid_simple()),
            project_id: original.project_id.clone(),
            title: format!("{} (fork)", original.title),
            workdir: original.workdir.clone(),
            thread_id: None, // fork 出去的是新会话，不继承 codex thread
            model: original.model.clone(),
            messages,
            created_at: now,
            updated_at: now,
            deleted_at: None,
            forked_from: Some(ForkedFrom {
                session_id: original.id.clone(),
                message_index,
            }),
        };
        Self::save_session(&new_session).map_err(|e| e.to_string())?;
        Ok(new_session)
    }

    // ── 搜索 ──

    /// 全文搜索：扫描所有未删除会话，匹配 title 和消息内容
    pub fn search_sessions(
        query: &str,
        project_id: Option<&str>,
    ) -> Vec<SessionSearchHit> {
        let q = query.trim();
        if q.is_empty() {
            return Vec::new();
        }
        let q_lower = q.to_lowercase();
        let mut hits: Vec<SessionSearchHit> = Vec::new();
        let dir = Self::sessions_dir();
        if !dir.exists() {
            return hits;
        }
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(session) = serde_json::from_str::<Session>(&content) {
                        if session.deleted_at.is_some() {
                            continue;
                        }
                        if let Some(pid) = project_id {
                            if session.project_id != pid {
                                continue;
                            }
                        }
                        // 1. 标题命中
                        if session.title.to_lowercase().contains(&q_lower) {
                            hits.push(SessionSearchHit {
                                session: SessionMeta::from(&session),
                                match_field: "title".to_string(),
                                snippet: snippet_around(&session.title, q, 120),
                            });
                            continue;
                        }
                        // 2. 消息内容命中
                        for msg in &session.messages {
                            let text = extract_msg_text(msg);
                            if let Some(idx) = text.to_lowercase().find(&q_lower) {
                                hits.push(SessionSearchHit {
                                    session: SessionMeta::from(&session),
                                    match_field: "content".to_string(),
                                    snippet: snippet_around(&text, q, 120).replacen(
                                        &text[idx..idx + q.len()],
                                        &format!("⟪{}⟫", &text[idx..idx + q.len()]),
                                        1,
                                    ),
                                });
                                break; // 每个会话只取第一条命中
                            }
                        }
                    }
                }
            }
        }
        // 标题匹配优先，然后按 updated_at 倒序
        hits.sort_by(|a, b| {
            b.session
                .updated_at
                .cmp(&a.session.updated_at)
                .then_with(|| a.match_field.cmp(&b.match_field))
        });
        hits
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
fn extract_msg_text(msg: &serde_json::Value) -> String {
    msg.get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// 在文本中围绕查询词生成片段（最多 max_chars 字符）
fn snippet_around(text: &str, query: &str, max_chars: usize) -> String {
    let lower = text.to_lowercase();
    let q_lower = query.to_lowercase();
    if let Some(idx) = lower.find(&q_lower) {
        let start = idx.saturating_sub(max_chars / 3);
        let end = (idx + q_lower.len() + max_chars * 2 / 3).min(text.len());
        let mut s = text[start..end].to_string();
        if start > 0 {
            s = format!("…{}", s);
        }
        if end < text.len() {
            s.push('…');
        }
        return s;
    }
    // 截取开头
    let end = max_chars.min(text.len());
    let mut s = text[..end].to_string();
    if text.len() > end {
        s.push('…');
    }
    s
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut x = nanos as u64;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    let rand: u64 = x;
    format!("{:x}{:x}", nanos, rand)
}

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