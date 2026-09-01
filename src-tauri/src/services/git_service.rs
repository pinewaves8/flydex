use std::io::Write;
use std::process::{Command, Stdio};

use crate::types::git::{
    ChangeState, CommitResult, DiffHunk, FileChange, GitBranch, GitCommit, GitRemote, GitStatus,
    GitSyncResult,
};

/// 解析 unified diff 时的累积器（未暂存/工作区 diff）
#[derive(Default)]
struct DiffAcc {
    path: String,
    in_hunk: bool,
    hunk_header: String,
    hunk_lines: Vec<String>,
    insertions: usize,
    deletions: usize,
}

/// 解析 cached diff 时的累积器
#[derive(Default)]
struct CachedAcc {
    path: String,
    in_hunk: bool,
    insertions: usize,
    deletions: usize,
}

/// Git 服务
///
/// 封装 git CLI 命令，提供分支管理、变更查看、hunk 级暂存、提交等能力。
pub struct GitService;

impl GitService {
    /// 执行 git 命令，返回 (exit_code, stdout, stderr)
    fn run_git(repo: &str, args: &[&str], stdin_input: Option<&str>) -> (i32, String, String) {
        let mut cmd = Command::new("git");
        // 关闭路径转义，避免中文文件名变成 \346\265\213 形式
        cmd.arg("-c")
            .arg("core.quotepath=false")
            .args(args)
            .current_dir(repo)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if stdin_input.is_some() {
            cmd.stdin(Stdio::piped());
        } else {
            cmd.stdin(Stdio::null());
        }

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => return (1, String::new(), format!("failed to spawn git: {e}")),
        };

        if let Some(input) = stdin_input {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(input.as_bytes());
                let _ = stdin.flush();
            }
        }

        let output = match child.wait_with_output() {
            Ok(o) => o,
            Err(e) => return (1, String::new(), format!("failed to wait git: {e}")),
        };

        let code = output.status.code().unwrap_or(-1);
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        (code, stdout, stderr)
    }

    /// 检查路径是否为 git 仓库
    pub fn is_repo(repo: &str) -> bool {
        let (code, _, _) = Self::run_git(repo, &["rev-parse", "--is-inside-work-tree"], None);
        code == 0
    }

    /// 获取当前分支名
    fn current_branch(repo: &str) -> (String, bool) {
        let (code, stdout, _) = Self::run_git(repo, &["rev-parse", "--abbrev-ref", "HEAD"], None);
        if code != 0 {
            return ("unknown".to_string(), false);
        }
        let branch = stdout.trim().to_string();
        if branch == "HEAD" {
            // detached HEAD，尝试取短哈希
            let (code2, stdout2, _) =
                Self::run_git(repo, &["rev-parse", "--short", "HEAD"], None);
            if code2 == 0 {
                return (format!("detached@{}", stdout2.trim()), true);
            }
            return ("detached".to_string(), true);
        }
        (branch, false)
    }

    /// 获取 git 状态（变更列表 + 当前分支）
    pub fn status(repo: &str) -> Result<GitStatus, String> {
        if !Self::is_repo(repo) {
            return Err("not a git repository".to_string());
        }

        let (branch, detached) = Self::current_branch(repo);

        let (code, stdout, stderr) = Self::run_git(
            repo,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            None,
        );
        if code != 0 {
            return Err(format!("git status failed: {stderr}"));
        }

        let changes = Self::parse_porcelain(&stdout, repo);
        let (ahead, behind) = Self::ahead_behind(repo);

        Ok(GitStatus {
            branch,
            detached,
            changes,
            ahead,
            behind,
        })
    }

    /// 解析 porcelain=v1 -z 输出（NUL 分隔）
    fn parse_porcelain(raw: &str, repo: &str) -> Vec<FileChange> {
        let mut changes = Vec::new();
        let mut fields: Vec<&str> = raw.split('\0').collect();
        if fields.last() == Some(&"") {
            fields.pop();
        }

        let mut i = 0;
        while i < fields.len() {
            let status_field = fields[i];
            i += 1;
            if status_field.is_empty() {
                continue;
            }
            let xy: Vec<char> = status_field.chars().collect();
            if xy.len() < 2 {
                continue;
            }
            let (x, y) = (xy[0], xy[1]);

            let path = if status_field.len() == 2 {
                if i < fields.len() {
                    let p = fields[i].to_string();
                    i += 1;
                    p
                } else {
                    continue;
                }
            } else {
                status_field[2..].to_string()
            };

            let (state, staged, unstaged) = match (x, y) {
                ('?', _) => (ChangeState::Untracked, false, true),
                ('A', ' ') => (ChangeState::Added, true, false),
                ('A', 'M') => (ChangeState::StagedModified, true, true),
                ('M', ' ') => (ChangeState::Staged, true, false),
                ('M', 'M') => (ChangeState::StagedModified, true, true),
                (' ', 'M') => (ChangeState::Modified, false, true),
                ('D', ' ') => (ChangeState::Deleted, true, false),
                (' ', 'D') => (ChangeState::Deleted, false, true),
                ('R', _) => (ChangeState::Renamed, true, false),
                _ => (ChangeState::Modified, false, true),
            };

            changes.push(FileChange {
                path,
                state,
                staged,
                unstaged,
                insertions: 0,
                deletions: 0,
                hunks: Vec::new(),
            });
        }

        // 未暂存 diff：统计增删 + 提取 hunk
        let (code, diff_out, _) = Self::run_git(
            repo,
            &["diff", "--no-color", "--unified=3", "--no-ext-diff"],
            None,
        );
        if code == 0 {
            Self::attach_worktree_diff(&mut changes, &diff_out);
        }
        // 已暂存 diff：统计增删 + 标记 staged
        let (code2, cached_out, _) = Self::run_git(
            repo,
            &["diff", "--cached", "--no-color", "--unified=3", "--no-ext-diff"],
            None,
        );
        if code2 == 0 {
            Self::attach_cached_diff(&mut changes, &cached_out);
        }

        changes
    }

    /// 解析工作区 unified diff：提取每个文件的 hunk 和增删行数
    fn attach_worktree_diff(changes: &mut [FileChange], diff: &str) {
        let mut acc = DiffAcc::default();
        let all: Vec<&str> = diff.lines().collect();
        let mut idx = 0;
        while idx < all.len() {
            let line = all[idx];
            if let Some(rest) = line.strip_prefix("diff --git ") {
                Self::flush_diff_acc(changes, &mut acc);
                let parts: Vec<&str> = rest.split_whitespace().collect();
                if let Some(b_part) = parts.iter().find(|p| p.starts_with("b/")) {
                    acc.path = b_part[2..].to_string();
                }
                acc.in_hunk = false;
                acc.hunk_lines.clear();
                acc.insertions = 0;
                acc.deletions = 0;
            } else if let Some(rest) = line.strip_prefix("+++ b/") {
                let clean = rest.split('\t').next().unwrap_or(rest).trim_end();
                if !clean.is_empty() {
                    acc.path = clean.to_string();
                }
            } else if line.starts_with("@@") {
                acc.in_hunk = true;
                acc.hunk_header = line.to_string();
                acc.hunk_lines.push(line.to_string());
            } else if acc.in_hunk {
                acc.hunk_lines.push(line.to_string());
                if let Some(rest) = line.strip_prefix('+') {
                    if !rest.starts_with("++") {
                        acc.insertions += 1;
                    }
                } else if let Some(rest) = line.strip_prefix('-') {
                    if !rest.starts_with("--") {
                        acc.deletions += 1;
                    }
                }
            }
            idx += 1;
        }
        Self::flush_diff_acc(changes, &mut acc);
    }

    fn flush_diff_acc(changes: &mut [FileChange], acc: &mut DiffAcc) {
        if acc.path.is_empty() || acc.hunk_lines.is_empty() {
            acc.path.clear();
            acc.in_hunk = false;
            acc.hunk_header.clear();
            acc.hunk_lines.clear();
            acc.insertions = 0;
            acc.deletions = 0;
            return;
        }
        let content = acc.hunk_lines.join("\n");
        let hunk = DiffHunk {
            header: acc.hunk_header.clone(),
            content,
            start_line: 0,
        };
        if let Some(c) = changes.iter_mut().find(|c| c.path == acc.path) {
            c.hunks.push(hunk);
            c.insertions += acc.insertions;
            c.deletions += acc.deletions;
        }
        acc.path.clear();
        acc.in_hunk = false;
        acc.hunk_header.clear();
        acc.hunk_lines.clear();
        acc.insertions = 0;
        acc.deletions = 0;
    }

    /// 解析已暂存 cached diff：统计增删行数并标记 staged
    fn attach_cached_diff(changes: &mut [FileChange], diff: &str) {
        let mut acc = CachedAcc::default();
        let all: Vec<&str> = diff.lines().collect();
        let mut idx = 0;
        while idx < all.len() {
            let line = all[idx];
            if let Some(rest) = line.strip_prefix("diff --git ") {
                Self::flush_cached_acc(changes, &mut acc);
                let parts: Vec<&str> = rest.split_whitespace().collect();
                if let Some(b_part) = parts.iter().find(|p| p.starts_with("b/")) {
                    acc.path = b_part[2..].to_string();
                }
                acc.in_hunk = false;
                acc.insertions = 0;
                acc.deletions = 0;
            } else if let Some(rest) = line.strip_prefix("+++ b/") {
                let clean = rest.split('\t').next().unwrap_or(rest).trim_end();
                if !clean.is_empty() {
                    acc.path = clean.to_string();
                }
            } else if line.starts_with("@@") {
                acc.in_hunk = true;
            } else if acc.in_hunk {
                if let Some(r) = line.strip_prefix('+') {
                    if !r.starts_with("++") {
                        acc.insertions += 1;
                    }
                } else if let Some(r) = line.strip_prefix('-') {
                    if !r.starts_with("--") {
                        acc.deletions += 1;
                    }
                }
            }
            idx += 1;
        }
        Self::flush_cached_acc(changes, &mut acc);
    }

    fn flush_cached_acc(changes: &mut [FileChange], acc: &mut CachedAcc) {
        if acc.path.is_empty() {
            acc.in_hunk = false;
            acc.insertions = 0;
            acc.deletions = 0;
            return;
        }
        if let Some(c) = changes.iter_mut().find(|c| c.path == acc.path) {
            c.insertions += acc.insertions;
            c.deletions += acc.deletions;
            if acc.insertions > 0 || acc.deletions > 0 {
                c.staged = true;
            }
        }
        acc.path.clear();
        acc.in_hunk = false;
        acc.insertions = 0;
        acc.deletions = 0;
    }

    /// 获取 ahead/behind（相对上游）
    fn ahead_behind(repo: &str) -> (i32, i32) {
        let (code, stdout, _) = Self::run_git(
            repo,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
            None,
        );
        if code != 0 {
            return (0, 0);
        }
        let parts: Vec<&str> = stdout.split_whitespace().collect();
        if parts.len() == 2 {
            let ahead = parts[0].parse().unwrap_or(0);
            let behind = parts[1].parse().unwrap_or(0);
            (ahead, behind)
        } else {
            (0, 0)
        }
    }

    /// 获取所有分支
    pub fn branches(repo: &str) -> Result<Vec<GitBranch>, String> {
        if !Self::is_repo(repo) {
            return Err("not a git repository".to_string());
        }
        let (code, stdout, stderr) = Self::run_git(repo, &["branch", "-vv", "--no-color"], None);
        if code != 0 {
            return Err(format!("git branch failed: {stderr}"));
        }
        let mut branches = Vec::new();
        for line in stdout.lines() {
            let current = line.starts_with('*');
            let name_part = if current { &line[1..] } else { line };
            let name_part = name_part.trim_start();
            let desc_start = name_part
                .char_indices()
                .find(|(_, ch)| *ch == ' ' || *ch == '\t')
                .map(|(i, _)| i)
                .unwrap_or(name_part.len());
            let name = name_part[..desc_start].trim().to_string();
            let description = name_part[desc_start..].trim().to_string();
            branches.push(GitBranch {
                name,
                current,
                description,
            });
        }
        Ok(branches)
    }

    /// 切换分支
    pub fn checkout(repo: &str, branch: &str) -> Result<(), String> {
        let (code, _, stderr) = Self::run_git(repo, &["checkout", branch], None);
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    /// 获取单个文件的 unified diff（未暂存部分）
    pub fn diff(repo: &str, path: &str) -> Result<String, String> {
        let (code, stdout, stderr) = Self::run_git(
            repo,
            &["diff", "--no-color", "--unified=3", "--no-ext-diff", "--", path],
            None,
        );
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(stdout)
    }

    /// 生成未跟踪（新增）文件的 unified diff（git diff --no-index /dev/null <path>）
    ///
    /// --no-index 在存在差异时退出码为 1，属正常；返回新增文件全量内容作为 add diff。
    pub fn diff_untracked(repo: &str, path: &str) -> Result<String, String> {
        let (code, stdout, stderr) = Self::run_git(
            repo,
            &[
                "diff", "--no-index", "--no-color", "--unified=3", "--no-ext-diff", "--", "/dev/null",
                path,
            ],
            None,
        );
        if code != 0 && code != 1 {
            return Err(stderr.trim().to_string());
        }
        Ok(stdout)
    }

    /// 判断文件是否被 git 跟踪（含已删除但仍处于索引中的 tracked 文件）
    fn is_tracked(repo: &str, rel_path: &str) -> bool {
        let (code, _, _) =
            Self::run_git(repo, &["ls-files", "--error-unmatch", "--", rel_path], None);
        code == 0
    }

    /// 归一化路径：绝对路径裁剪为相对 repo 的相对路径；分隔符统一为 '/'
    fn rel_path(repo: &str, path: &str) -> String {
        let p = std::path::Path::new(path);
        if p.is_absolute() {
            if let Ok(rel) = p.strip_prefix(repo) {
                return rel.to_string_lossy().replace('\\', "/");
            }
        }
        path.replace('\\', "/")
    }

    /// 获取文件的 diff（自动处理 tracked/untracked/删除），供对话流"文件变更卡片"使用
    ///
    /// - tracked 文件（含工作区已删除）：git diff 显示修改/删除
    /// - untracked 文件：git diff --no-index /dev/null 显示全量新增
    pub fn diff_file(repo: &str, path: &str) -> Result<String, String> {
        let rel = Self::rel_path(repo, path);
        if Self::is_tracked(repo, &rel) {
            return Self::diff(repo, &rel);
        }
        Self::diff_untracked(repo, &rel)
    }

    /// 拒绝文件变更（回滚）：tracked → git restore 恢复；untracked → 删除文件
    pub fn discard_file(repo: &str, path: &str) -> Result<(), String> {
        let rel = Self::rel_path(repo, path);
        if Self::is_tracked(repo, &rel) {
            return Self::discard_changes(repo, Some(&rel));
        }
        Self::discard_untracked(repo, &rel)
    }

    /// 删除未跟踪文件（git clean -f -- path），用于拒绝"新增文件"变更
    pub fn discard_untracked(repo: &str, path: &str) -> Result<(), String> {
        let (code, _, stderr) = Self::run_git(repo, &["clean", "-f", "--", path], None);
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    /// 获取工作区实际变更文件列表（对话流"写入后审查"兜底）。
    ///
    /// 解析 `git status --porcelain=v1 -z --untracked-files=all`：
    /// - `??` → add（未跟踪）
    /// - `A*` → add（新增，含已暂存）
    /// - `D*` / `*D` → delete
    /// - 其余（M/R/C 等）→ update
    pub fn status_changes(repo: &str) -> Result<Vec<crate::types::git::FileChangeBrief>, String> {
        use crate::types::git::FileChangeBrief;
        if !Self::is_repo(repo) {
            return Ok(Vec::new());
        }
        let (code, stdout, stderr) = Self::run_git(
            repo,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            None,
        );
        if code != 0 {
            return Err(format!("git status failed: {stderr}"));
        }
        let mut changes = Vec::new();
        // -z 模式：每条记录形如 "XY path\0"（NUL 分隔，无换行）
        for entry in stdout.split('\0') {
            if entry.len() < 4 {
                continue;
            }
            let (xy, path) = entry.split_at(3); // "XY " 3 字节
            let code = &xy[..2];
            let kind = if code == "??" || code.starts_with('A') {
                "add"
            } else if code.starts_with('D') || code.ends_with('D') {
                "delete"
            } else {
                "update"
            };
            changes.push(FileChangeBrief {
                path: path.to_string(),
                kind: kind.to_string(),
            });
        }
        Ok(changes)
    }

    /// 获取已暂存 diff（用于提交前确认）
    pub fn diff_cached(repo: &str, path: &str) -> Result<String, String> {
        let (code, stdout, stderr) = Self::run_git(
            repo,
            &[
                "diff", "--cached", "--no-color", "--unified=3", "--no-ext-diff", "--", path,
            ],
            None,
        );
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(stdout)
    }

    /// 从完整 diff 中切出所有 hunk（含 hunk 头）
    pub fn split_hunks(diff: &str) -> Vec<String> {
        let mut hunks = Vec::new();
        let mut current = String::new();
        for line in diff.lines() {
            if line.starts_with("@@") {
                if !current.is_empty() {
                    hunks.push(current);
                }
                current = format!("{}\n", line);
            } else if !current.is_empty() {
                current.push_str(line);
                current.push('\n');
            }
        }
        if !current.is_empty() {
            hunks.push(current);
        }
        hunks
    }

    /// 从完整 diff 中提取文件头（diff --git / index / --- / +++）+ 指定 hunk 组成独立 patch
    ///
    /// 注意：
    /// - 过滤 `\ No newline at end of file` 标记（git diff 的人类可读注释，非 patch 语法）
    /// - 去掉每行尾随 `\r`（防止 Windows CRLF 干扰 patch 解析）
    fn build_patch_with_hunk(full_diff: &str, target_hunk: &str) -> String {
        let target_header = target_hunk
            .lines()
            .next()
            .unwrap_or("")
            .trim_end_matches('\r')
            .trim_end();

        let lines: Vec<&str> = full_diff.lines().collect();

        // 收集文件头（第一个 diff --git 到第一个 @@ 之间的行）
        let mut header: Vec<&str> = Vec::new();
        let mut found_header_start = false;
        for line in &lines {
            let l = line.trim_end_matches('\r');
            if l.starts_with("diff --git ") {
                found_header_start = true;
            }
            if found_header_start && !l.starts_with("@@") {
                header.push(l);
            } else if l.starts_with("@@") {
                break;
            }
        }

        // 提取目标 hunk 内容（从目标 @@ 到下一个 @@ 或结束）
        let mut body: Vec<&str> = Vec::new();
        let mut found = false;
        for line in &lines {
            let l = line.trim_end_matches('\r');
            if l.starts_with("@@") {
                if found {
                    break;
                }
                if l.trim_end() == target_header {
                    found = true;
                    body.push(l);
                }
                continue;
            }
            if found {
                // 过滤 no-newline 标记
                if l.starts_with("\\ No newline") {
                    continue;
                }
                body.push(l);
            }
        }

        let mut patch = String::new();
        for l in header.iter().chain(body.iter()) {
            patch.push_str(l);
            patch.push('\n');
        }
        patch
    }

    /// 暂存指定 hunk（用 git apply --cached 应用 patch 片段）
    pub fn stage_hunk(repo: &str, path: &str, hunk_index: usize) -> Result<(), String> {
        let full_diff = Self::diff(repo, path)?;
        if full_diff.is_empty() {
            return Err("no unstaged diff for file".to_string());
        }
        let hunks = Self::split_hunks(&full_diff);
        if hunk_index >= hunks.len() {
            return Err(format!("hunk index out of range: {hunk_index}"));
        }

        let patch = Self::build_patch_with_hunk(&full_diff, &hunks[hunk_index]);
        if patch.trim().is_empty() {
            return Err("failed to build hunk patch".to_string());
        }

        let (code, _, stderr) = Self::run_git(repo, &["apply", "--cached"], Some(&patch));
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    /// 取消暂存指定 hunk
    pub fn unstage_hunk(repo: &str, path: &str, hunk_index: usize) -> Result<(), String> {
        let cached_diff = Self::diff_cached(repo, path)?;
        if cached_diff.is_empty() {
            return Err("no staged diff for file".to_string());
        }
        let hunks = Self::split_hunks(&cached_diff);
        if hunk_index >= hunks.len() {
            return Err(format!("hunk index out of range: {hunk_index}"));
        }
        let patch = Self::build_patch_with_hunk(&cached_diff, &hunks[hunk_index]);
        if patch.trim().is_empty() {
            return Err("failed to build hunk patch".to_string());
        }
        let (code, _, stderr) =
            Self::run_git(repo, &["apply", "--cached", "-R"], Some(&patch));
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    /// 提交
    pub fn commit(repo: &str, message: &str) -> Result<CommitResult, String> {
        let message = message.trim();
        if message.is_empty() {
            return Err("commit message cannot be empty".to_string());
        }
        let (code0, _, _) = Self::run_git(repo, &["diff", "--cached", "--quiet"], None);
        if code0 == 0 {
            return Err("nothing to commit (no staged changes)".to_string());
        }
        let (code, _, stderr) = Self::run_git(repo, &["commit", "-m", message], None);
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        let (code2, stdout2, _) = Self::run_git(repo, &["rev-parse", "--short", "HEAD"], None);
        let hash = if code2 == 0 {
            stdout2.trim().to_string()
        } else {
            String::new()
        };
        Ok(CommitResult {
            hash,
            message: message.to_string(),
        })
    }

    // ── 分支管理 ──

    /// 创建分支（默认不切换）
    pub fn create_branch(repo: &str, name: &str, base: Option<&str>) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("branch name cannot be empty".to_string());
        }
        let mut args = vec!["branch", name];
        if let Some(base) = base {
            if !base.trim().is_empty() {
                args.push(base.trim());
            }
        }
        let (code, _, stderr) = Self::run_git(repo, &args, None);
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    /// 重命名分支
    pub fn rename_branch(repo: &str, old_name: &str, new_name: &str) -> Result<(), String> {
        let (code, _, stderr) = Self::run_git(
            repo,
            &["branch", "-m", old_name.trim(), new_name.trim()],
            None,
        );
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    /// 删除分支（安全删除 -d，未合并将失败）
    pub fn delete_branch(repo: &str, name: &str) -> Result<(), String> {
        let (code, _, stderr) = Self::run_git(repo, &["branch", "-d", name.trim()], None);
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    // ── 远端与同步 ──

    /// 获取远端列表
    pub fn remotes(repo: &str) -> Result<Vec<GitRemote>, String> {
        let (code, stdout, stderr) = Self::run_git(repo, &["remote", "-v"], None);
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        let mut remotes: Vec<GitRemote> = Vec::new();
        for line in stdout.lines() {
            // 格式: origin  https://... (fetch)
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 && parts.last() == Some(&"(fetch)") {
                let name = parts[0].to_string();
                let url = parts[1].to_string();
                if !remotes.iter().any(|r| r.name == name) {
                    remotes.push(GitRemote { name, url });
                }
            }
        }
        Ok(remotes)
    }

    /// 添加远端
    pub fn add_remote(repo: &str, name: &str, url: &str) -> Result<(), String> {
        let (code, _, stderr) = Self::run_git(
            repo,
            &["remote", "add", name.trim(), url.trim()],
            None,
        );
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    /// 移除远端
    pub fn remove_remote(repo: &str, name: &str) -> Result<(), String> {
        let (code, _, stderr) = Self::run_git(repo, &["remote", "remove", name.trim()], None);
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    /// 拉取远端更新（fetch）
    pub fn fetch(repo: &str, remote: Option<&str>) -> Result<GitSyncResult, String> {
        let mut args = vec!["fetch"];
        if let Some(r) = remote {
            if !r.trim().is_empty() {
                args.push(r.trim());
            }
        }
        let (code, stdout, stderr) = Self::run_git(repo, &args, None);
        let msg = if stdout.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            stdout.trim().to_string()
        };
        if code != 0 {
            return Ok(GitSyncResult {
                ok: false,
                message: if msg.is_empty() {
                    "fetch failed".to_string()
                } else {
                    msg
                },
            });
        }
        Ok(GitSyncResult {
            ok: true,
            message: if msg.is_empty() {
                "已获取更新".to_string()
            } else {
                msg
            },
        })
    }

    /// 推送（push）
    pub fn push(
        repo: &str,
        remote: Option<&str>,
        branch: Option<&str>,
        force: bool,
    ) -> Result<GitSyncResult, String> {
        let mut args = vec!["push"];
        if force {
            args.push("--force");
        }
        if let Some(r) = remote {
            if !r.trim().is_empty() {
                args.push(r.trim());
            }
        }
        if let Some(b) = branch {
            if !b.trim().is_empty() {
                args.push(b.trim());
            }
        }
        let (code, stdout, stderr) = Self::run_git(repo, &args, None);
        let msg = if stdout.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            stdout.trim().to_string()
        };
        if code != 0 {
            return Ok(GitSyncResult {
                ok: false,
                message: if msg.is_empty() {
                    "push failed".to_string()
                } else {
                    msg
                },
            });
        }
        Ok(GitSyncResult {
            ok: true,
            message: if msg.is_empty() {
                "推送成功".to_string()
            } else {
                msg
            },
        })
    }

    /// 拉取并合并（pull）
    pub fn pull(
        repo: &str,
        remote: Option<&str>,
        branch: Option<&str>,
    ) -> Result<GitSyncResult, String> {
        let mut args = vec!["pull"];
        if let Some(r) = remote {
            if !r.trim().is_empty() {
                args.push(r.trim());
            }
        }
        if let Some(b) = branch {
            if !b.trim().is_empty() {
                args.push(b.trim());
            }
        }
        let (code, stdout, stderr) = Self::run_git(repo, &args, None);
        let msg = if stdout.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            stdout.trim().to_string()
        };
        if code != 0 {
            return Ok(GitSyncResult {
                ok: false,
                message: if msg.is_empty() {
                    "pull failed".to_string()
                } else {
                    msg
                },
            });
        }
        Ok(GitSyncResult {
            ok: true,
            message: if msg.is_empty() {
                "拉取成功".to_string()
            } else {
                msg
            },
        })
    }

    // ── 暂存与放弃 ──

    /// 暂存整个文件
    pub fn stage_file(repo: &str, path: &str) -> Result<(), String> {
        let (code, _, stderr) = Self::run_git(repo, &["add", "--", path], None);
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    /// 取消暂存整个文件
    pub fn unstage_file(repo: &str, path: &str) -> Result<(), String> {
        let (code, _, stderr) = Self::run_git(repo, &["restore", "--staged", "--", path], None);
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    /// 暂存全部变更
    pub fn stage_all(repo: &str) -> Result<(), String> {
        let (code, _, stderr) = Self::run_git(repo, &["add", "-A"], None);
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    /// 取消暂存全部（保留工作区改动）
    pub fn unstage_all(repo: &str) -> Result<(), String> {
        let (code, _, stderr) = Self::run_git(repo, &["reset"], None);
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    /// 放弃工作区改动（restore，仅 tracked 文件；untracked 不删除）
    pub fn discard_changes(repo: &str, path: Option<&str>) -> Result<(), String> {
        let mut args = vec!["restore"];
        match path {
            Some(p) if !p.trim().is_empty() => {
                args.push("--");
                args.push(p.trim());
            }
            _ => {
                args.push("--worktree");
                args.push(".");
            }
        }
        let (code, _, stderr) = Self::run_git(repo, &args, None);
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(())
    }

    // ── 提交历史 ──

    /// 获取提交历史列表
    pub fn log(repo: &str, limit: usize) -> Result<Vec<GitCommit>, String> {
        let limit = if limit == 0 { 50 } else { limit.min(200) };
        let fmt = "%H%x1f%h%x1f%an%x1f%at%x1f%s";
        let n_arg = format!("-n {}", limit);
        let fmt_arg = format!("--pretty=format:{}", fmt);
        let args = vec![
            "log",
            n_arg.as_str(),
            fmt_arg.as_str(),
        ];
        let (code, stdout, stderr) = Self::run_git(repo, &args, None);
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        let mut commits = Vec::new();
        for line in stdout.lines() {
            let fields: Vec<&str> = line.split('\x1f').collect();
            if fields.len() >= 5 {
                commits.push(GitCommit {
                    hash: fields[0].to_string(),
                    short_hash: fields[1].to_string(),
                    author: fields[2].to_string(),
                    timestamp: fields[3].parse().unwrap_or(0),
                    summary: fields[4].to_string(),
                });
            }
        }
        Ok(commits)
    }

    /// 查看某次提交的完整 diff
    pub fn show(repo: &str, hash: &str) -> Result<String, String> {
        let (code, stdout, stderr) = Self::run_git(
            repo,
            &["show", "--no-color", "--stat", hash],
            None,
        );
        if code != 0 {
            return Err(stderr.trim().to_string());
        }
        Ok(stdout)
    }
}
