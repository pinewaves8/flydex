use crate::services::git_service::GitService;
use crate::types::git::{
    CommitResult, FileChangeBrief, GitBranch, GitCommit, GitRemote, GitStatus, GitSyncResult,
};

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

/// 获取文件的 diff（自动处理 tracked/untracked/删除），供对话流"文件变更卡片"使用
#[tauri::command]
pub fn git_diff_file(repo: String, path: String) -> Result<String, String> {
    GitService::diff_file(&repo, &path)
}

/// 拒绝文件变更（回滚）：tracked 恢复 / untracked 删除，供对话流"文件变更卡片"使用
#[tauri::command]
pub fn git_discard_file(repo: String, path: String) -> Result<(), String> {
    GitService::discard_file(&repo, &path)
}

/// 获取工作区实际变更文件列表（对话流"写入后审查"兜底）
#[tauri::command]
pub fn git_status_changes(repo: String) -> Result<Vec<FileChangeBrief>, String> {
    GitService::status_changes(&repo)
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

/// 创建分支
#[tauri::command]
pub fn git_create_branch(repo: String, name: String, base: Option<String>) -> Result<(), String> {
    GitService::create_branch(&repo, &name, base.as_deref())
}

/// 重命名分支
#[tauri::command]
pub fn git_rename_branch(
    repo: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    GitService::rename_branch(&repo, &old_name, &new_name)
}

/// 删除分支
#[tauri::command]
pub fn git_delete_branch(repo: String, name: String) -> Result<(), String> {
    GitService::delete_branch(&repo, &name)
}

/// 获取远端列表
#[tauri::command]
pub fn git_remotes(repo: String) -> Result<Vec<GitRemote>, String> {
    GitService::remotes(&repo)
}

/// 添加远端
#[tauri::command]
pub fn git_add_remote(repo: String, name: String, url: String) -> Result<(), String> {
    GitService::add_remote(&repo, &name, &url)
}

/// 移除远端
#[tauri::command]
pub fn git_remove_remote(repo: String, name: String) -> Result<(), String> {
    GitService::remove_remote(&repo, &name)
}

/// 拉取远端更新
#[tauri::command]
pub fn git_fetch(repo: String, remote: Option<String>) -> Result<GitSyncResult, String> {
    GitService::fetch(&repo, remote.as_deref())
}

/// 推送
#[tauri::command]
pub fn git_push(
    repo: String,
    remote: Option<String>,
    branch: Option<String>,
    force: bool,
) -> Result<GitSyncResult, String> {
    GitService::push(&repo, remote.as_deref(), branch.as_deref(), force)
}

/// 拉取并合并
#[tauri::command]
pub fn git_pull(
    repo: String,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<GitSyncResult, String> {
    GitService::pull(&repo, remote.as_deref(), branch.as_deref())
}

/// 暂存整个文件
#[tauri::command]
pub fn git_stage_file(repo: String, path: String) -> Result<(), String> {
    GitService::stage_file(&repo, &path)
}

/// 取消暂存整个文件
#[tauri::command]
pub fn git_unstage_file(repo: String, path: String) -> Result<(), String> {
    GitService::unstage_file(&repo, &path)
}

/// 暂存全部变更
#[tauri::command]
pub fn git_stage_all(repo: String) -> Result<(), String> {
    GitService::stage_all(&repo)
}

/// 取消暂存全部
#[tauri::command]
pub fn git_unstage_all(repo: String) -> Result<(), String> {
    GitService::unstage_all(&repo)
}

/// 放弃工作区改动
#[tauri::command]
pub fn git_discard_changes(repo: String, path: Option<String>) -> Result<(), String> {
    GitService::discard_changes(&repo, path.as_deref())
}

/// 提交历史列表
#[tauri::command]
pub fn git_log(repo: String, limit: usize) -> Result<Vec<GitCommit>, String> {
    GitService::log(&repo, limit)
}

/// 查看提交详情
#[tauri::command]
pub fn git_show(repo: String, hash: String) -> Result<String, String> {
    GitService::show(&repo, &hash)
}
