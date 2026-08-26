use crate::services::git_service::GitService;
use crate::types::git::{CommitResult, GitBranch, GitStatus};

/// 获取 git 状态
#[tauri::command]
pub fn git_status(repo: String) -> Result<GitStatus, String> {
    GitService::status(&repo)
}

/// 获取所有分支
#[tauri::command]
pub fn git_branches(repo: String) -> Result<Vec<GitBranch>, String> {
    GitService::branches(&repo)
}

/// 切换分支
#[tauri::command]
pub fn git_checkout(repo: String, branch: String) -> Result<(), String> {
    GitService::checkout(&repo, &branch)
}

/// 获取单个文件的未暂存 diff
#[tauri::command]
pub fn git_diff(repo: String, path: String) -> Result<String, String> {
    GitService::diff(&repo, &path)
}

/// 获取单个文件的已暂存 diff
#[tauri::command]
pub fn git_diff_cached(repo: String, path: String) -> Result<String, String> {
    GitService::diff_cached(&repo, &path)
}

/// 暂存指定 hunk
#[tauri::command]
pub fn git_stage_hunk(repo: String, path: String, hunk_index: usize) -> Result<(), String> {
    GitService::stage_hunk(&repo, &path, hunk_index)
}

/// 取消暂存指定 hunk
#[tauri::command]
pub fn git_unstage_hunk(repo: String, path: String, hunk_index: usize) -> Result<(), String> {
    GitService::unstage_hunk(&repo, &path, hunk_index)
}

/// 提交
#[tauri::command]
pub fn git_commit(repo: String, message: String) -> Result<CommitResult, String> {
    GitService::commit(&repo, &message)
}
