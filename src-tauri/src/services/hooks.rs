use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::services::security::{RuleDecision, SecurityService};
use crate::services::storage::Storage;

/// 支持的事件（对齐 Claude Code hook events 的 flydex 实用子集）
pub const EVENTS: &[&str] = &[
    "ThreadStarted",
    "TurnStarted",
    "TurnCompleted",
    "TurnError",
    "MessageReceived",
    "CommandExecuted",
    "FileChanged",
    "ApprovalRequested",
    "Stop",
];

/// 一条 hook 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hook {
    pub event: String,
    pub command: String,
    #[serde(default)]
    pub note: String,
}

/// hooks 配置（持久化 ~/.flydex/hooks.json）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HooksConfig {
    #[serde(default)]
    pub hooks: Vec<Hook>,
}

/// hook 执行结果（hooks_test 返回）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookRunResult {
    pub exit: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub skipped: bool,
    pub reason: String,
    pub ms: u64,
}

pub struct HooksService;

impl HooksService {
    fn file() -> PathBuf {
        Storage::app_dir().join("hooks.json")
    }

    fn audit_file() -> PathBuf {
        Storage::app_dir().join("hooks-audit.jsonl")
    }

    pub fn load() -> HooksConfig {
        let path = Self::file();
        if !path.exists() {
            return HooksConfig::default();
        }
        fs::read_to_string(&path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default()
    }

    fn save(config: &HooksConfig) -> std::io::Result<()> {
        fs::create_dir_all(Storage::app_dir())?;
        let content = serde_json::to_string_pretty(config).unwrap_or_default();
        fs::write(Self::file(), content)
    }

    /// 事件名是否合法（大小写不敏感）
    pub fn valid_event(event: &str) -> bool {
        EVENTS.iter().any(|e| e.eq_ignore_ascii_case(event))
    }

    /// 新增 hook（event 必须合法 + command 非空 + 同 event 同 command 去重）
    pub fn add(event: String, command: String, note: String) -> Result<HooksConfig, String> {
        let event = event.trim().to_string();
        let command = command.trim().to_string();
        if !Self::valid_event(&event) {
            return Err(format!(
                "未知事件：{event}（支持：{}）",
                EVENTS.join(" / ")
            ));
        }
        if command.is_empty() {
            return Err("hook 命令不能为空".to_string());
        }
        let mut config = Self::load();
        if config.hooks.iter().any(|h| h.event.eq_ignore_ascii_case(&event) && h.command == command) {
            return Ok(config); // 已存在，幂等
        }
        config.hooks.push(Hook { event, command, note });
        Self::save(&config).map_err(|e| format!("保存 hooks 失败：{e}"))?;
        Ok(config)
    }

    /// 删除 hook（按 index）
    pub fn remove(index: usize) -> Result<HooksConfig, String> {
        let mut config = Self::load();
        if index < config.hooks.len() {
            config.hooks.remove(index);
        }
        Self::save(&config).map_err(|e| format!("保存 hooks 失败：{e}"))?;
        Ok(config)
    }

    /// 清空 hooks
    pub fn clear() -> Result<HooksConfig, String> {
        let config = HooksConfig::default();
        Self::save(&config).map_err(|e| format!("保存 hooks 失败：{e}"))?;
        Ok(config)
    }

    /// 白名单约束：内置 deny / 用户 deny 命中 → 跳过（安全底线，用户配置 hook 不可覆盖）
    fn blocked(command: &str) -> Option<String> {
        match SecurityService::decide(command) {
            RuleDecision::BuiltinDeny(r) | RuleDecision::UserDeny(r) => Some(r),
            _ => None,
        }
    }

    fn now_secs() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }

    /// 记录审计到 ~/.flydex/hooks-audit.jsonl（追加）
    fn audit(event: &str, command: &str, cwd: &str, exit: Option<i32>, skipped: bool, reason: &str, ms: u64) {
        let line = serde_json::json!({
            "ts": Self::now_secs(),
            "event": event,
            "command": command,
            "cwd": cwd,
            "exit": exit,
            "skipped": skipped,
            "reason": reason,
            "ms": ms,
        });
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(Self::audit_file()) {
            use std::io::Write;
            let _ = writeln!(f, "{line}");
        }
    }

    /// 触发事件：异步执行所有匹配 hook（不阻塞调用线程；deny 命中跳过并审计）
    pub fn fire(event: &str, payload: &serde_json::Value) {
        let config = Self::load();
        let ev = event.to_string();
        for h in config.hooks.iter().filter(|h| h.event.eq_ignore_ascii_case(&ev)) {
            let cmd = h.command.clone();
            let note = h.note.clone();
            let payload = payload.clone();
            let ev = ev.clone();
            std::thread::spawn(move || {
                let _ = Self::run_one(&ev, &cmd, &note, &payload);
            });
        }
    }

    /// 执行单个 hook 命令（PowerShell；30s 超时 kill；写审计）
    fn run_one(event: &str, command: &str, _note: &str, _payload: &serde_json::Value) -> HookRunResult {
        let start = Instant::now();
        let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default();
        let ms = || start.elapsed().as_millis() as u64;

        // 白名单约束（内置/用户 deny → 跳过）
        if let Some(reason) = Self::blocked(command) {
            let r = HookRunResult {
                exit: None,
                stdout: String::new(),
                stderr: String::new(),
                skipped: true,
                reason,
                ms: ms(),
            };
            Self::audit(event, command, &cwd, None, true, &r.reason, r.ms);
            return r;
        }

        let mut child = match Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", command])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(&cwd)
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let r = HookRunResult {
                    exit: None,
                    stdout: String::new(),
                    stderr: format!("spawn error: {e}"),
                    skipped: false,
                    reason: String::new(),
                    ms: ms(),
                };
                Self::audit(event, command, &cwd, None, false, &r.stderr, r.ms);
                return r;
            }
        };

        // 轮询等待 + 30s 超时 kill（避免 hook 卡死泄漏线程）
        let deadline = Instant::now() + Duration::from_secs(30);
        let status = loop {
            if let Some(s) = child.try_wait().ok().flatten() {
                break Some(s);
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                break None; // 超时
            }
            std::thread::sleep(Duration::from_millis(50));
        };

        let mut stdout = String::new();
        let mut stderr = String::new();
        let _ = child.stdout.take().map(|mut o| o.read_to_string(&mut stdout));
        let _ = child.stderr.take().map(|mut e| e.read_to_string(&mut stderr));

        let (exit, reason) = match &status {
            Some(s) => (s.code(), String::new()),
            None => (None, "timeout after 30s".to_string()),
        };
        let r = HookRunResult {
            exit,
            stdout,
            stderr,
            skipped: false,
            reason,
            ms: ms(),
        };
        Self::audit(event, command, &cwd, exit, false, &r.reason, r.ms);
        r
    }

    /// 测试执行：同步执行一次（返回 stdout/stderr/exit），用于前端 Test 按钮
    pub fn test(_event: &str, command: &str) -> HookRunResult {
        let start = Instant::now();
        if let Some(reason) = Self::blocked(command) {
            return HookRunResult {
                exit: None,
                stdout: String::new(),
                stderr: String::new(),
                skipped: true,
                reason,
                ms: start.elapsed().as_millis() as u64,
            };
        }
        let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default();
        let out = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", command])
            .current_dir(&cwd)
            .output();
        match out {
            Ok(o) => HookRunResult {
                exit: o.status.code(),
                stdout: String::from_utf8_lossy(&o.stdout).to_string(),
                stderr: String::from_utf8_lossy(&o.stderr).to_string(),
                skipped: false,
                reason: String::new(),
                ms: start.elapsed().as_millis() as u64,
            },
            Err(e) => HookRunResult {
                exit: None,
                stdout: String::new(),
                stderr: format!("spawn error: {e}"),
                skipped: false,
                reason: String::new(),
                ms: start.elapsed().as_millis() as u64,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_event_case_insensitive() {
        assert!(HooksService::valid_event("TurnCompleted"));
        assert!(HooksService::valid_event("turncompleted"));
        assert!(!HooksService::valid_event("NotARealEvent"));
    }

    #[test]
    fn event_list_nonempty_and_unique() {
        assert!(!EVENTS.is_empty());
        let mut seen = std::collections::HashSet::new();
        for e in EVENTS {
            assert!(seen.insert(e.to_lowercase()), "duplicate event: {e}");
        }
    }

    #[test]
    fn add_rejects_invalid_event_and_empty_command() {
        assert!(HooksService::add("Bogus".to_string(), "echo hi".to_string(), String::new()).is_err());
        assert!(HooksService::add("TurnCompleted".to_string(), "   ".to_string(), String::new()).is_err());
    }

    #[test]
    fn blocked_denies_dangerous_command() {
        // 内置 deny 白名单应拦截危险命令（hook 不执行）
        assert!(HooksService::blocked("rm -rf /").is_some());
        assert!(HooksService::blocked("git status").is_none());
    }
}
