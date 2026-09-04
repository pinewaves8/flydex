//! 工作区 git 自动快照（对齐 Claude Code：每轮 turn 完成后自动 commit 本地快照）。
//!
//! - 崩溃 / 误改后可回滚（`git log` 找 flydex-checkpoint，`git reset --hard` 回退）；
//! - 仅本地 commit，绝不 push；
//! - 非 git 仓库 / 无变更自动跳过；
//! - 任何失败静默忽略，不干扰主流程。
//!
//! 注意：调用方应放入独立线程执行（git add/commit 可能耗时，不能阻塞 app-server reader 线程）。

use std::path::Path;
use std::process::Command;

use crate::services::security::SecurityService;

/// 对工作区做一次本地 git 快照：`git add -A && git commit`。
/// 成功返回 commit message；跳过或失败返回 None。
pub fn checkpoint_workspace(cwd: &str) -> Option<String> {
    // 开关（~/.flydex/security.json 的 auto_checkpoint，默认开启）
    if !SecurityService::checkpoint_enabled() {
        return None;
    }
    let cwd = cwd.trim();
    if cwd.is_empty() || !Path::new(cwd).join(".git").exists() {
        return None;
    }
    // 工作区无变更 → 跳过（避免 nothing to commit 噪音）
    let status = Command::new("git")
        .arg("status")
        .arg("--porcelain")
        .current_dir(cwd)
        .output();
    let has_change = match status {
        Ok(o) => o.status.success() && !o.stdout.is_empty(),
        Err(_) => return None,
    };
    if !has_change {
        return None;
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let msg = format!("flydex-checkpoint {ts}");
    // git add -A
    let add = Command::new("git").arg("add").arg("-A").current_dir(cwd).output();
    if !add.map(|o| o.status.success()).unwrap_or(false) {
        return None;
    }
    // git commit -m
    let commit = Command::new("git")
        .arg("commit")
        .arg("-m")
        .arg(&msg)
        .current_dir(cwd)
        .output();
    if !commit.map(|o| o.status.success()).unwrap_or(false) {
        return None;
    }
    // 落日志文件（与 appserver 一致，便于脱机排查快照是否触发）
    eprintln!("[flydex] git checkpoint cwd={cwd} msg={msg}");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(r"C:\llm\flydex\logs\flydex-appserver.log")
    {
        use std::io::Write;
        let _ = writeln!(f, "[flydex] git checkpoint cwd={cwd} msg={msg}");
    }
    Some(msg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn git(dir: &std::path::Path, args: &[&str]) -> bool {
        Command::new("git").args(args).current_dir(dir).output().map(|o| o.status.success()).unwrap_or(false)
    }

    #[test]
    fn checkpoint_creates_commit_and_skips_no_change() {
        let dir = std::env::temp_dir().join(format!("flydex-cp-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(git(&dir, &["init", "-q"]));
        // 临时仓库必须配置身份才能 commit
        assert!(git(&dir, &["config", "user.email", "cp-test@local"]));
        assert!(git(&dir, &["config", "user.name", "cp-test"]));
        let cwd = dir.to_str().unwrap().to_string();

        // 有变更 -> 应提交
        fs::write(dir.join("a.txt"), "hello").unwrap();
        let msg = checkpoint_workspace(&cwd);
        assert!(msg.is_some(), "有变更应生成快照");

        // 无变更 -> 应跳过
        let msg2 = checkpoint_workspace(&cwd);
        assert!(msg2.is_none(), "无变更应跳过");

        // 提交信息可查
        let log = Command::new("git").arg("log").arg("--oneline").current_dir(&dir).output().unwrap();
        let log_s = String::from_utf8_lossy(&log.stdout);
        assert!(log_s.contains("flydex-checkpoint"), "commit 信息缺失: {log_s}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn checkpoint_skips_non_git_dir() {
        let dir = std::env::temp_dir().join(format!("flydex-cp-nongit-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.txt"), "hello").unwrap();
        let cwd = dir.to_str().unwrap().to_string();
        assert!(checkpoint_workspace(&cwd).is_none(), "非 git 目录应跳过");
        let _ = fs::remove_dir_all(&dir);
    }
}
