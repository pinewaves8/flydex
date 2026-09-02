//! Flydex - Tauri application backend

mod commands;
mod models;
mod services;
mod types;
mod utils;

use commands::codex::{approve_codex, run_codex, save_attachment_image, stop_codex};
use commands::git::{
    git_add_remote, git_branches, git_checkout, git_commit, git_create_branch, git_delete_branch,
    git_diff, git_diff_cached, git_diff_file, git_discard_changes, git_discard_file, git_fetch,
    git_init, git_is_repo, git_log, git_pull, git_push, git_remotes, git_remove_remote,
    git_rename_branch, git_review_diff, git_show, git_stage_all, git_stage_file,
    git_stage_hunk, git_status, git_status_changes, git_unstage_all, git_unstage_file,
    git_unstage_hunk, remove_review_diff, write_review_diff,
};
use commands::mcp::{mcp_builtin_web_server, mcp_list, mcp_remove, mcp_save, mcp_test};
use commands::model::{
    delete_model, delete_provider, get_models, set_current_model, set_reasoning_effort,
    test_model, test_model_connection, upsert_model, upsert_provider,
};
use commands::project::{create_project, delete_project, list_projects, update_project};
use commands::security::{
    clear_approval_history, get_security, record_approval, set_approval_policy, set_sandbox_mode,
};
use commands::session::{
    create_session, delete_session, export_session, fork_session, list_sessions,
    list_trashed_sessions, load_session, rename_session, restore_session, save_session,
    search_sessions, trash_session,
};
use commands::memory::{
    append_project_memory, append_user_memory, compact_summary, extract_memory, load_memory,
    write_project_memory, write_user_memory,
};
use commands::skill::{skill_list, skill_read};
use commands::terminal::resolve_dir;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            run_codex,
            approve_codex,
            stop_codex,
            save_attachment_image,
            // project
            list_projects,
            create_project,
            update_project,
            delete_project,
            // session
            list_sessions,
            list_trashed_sessions,
            load_session,
            create_session,
            save_session,
            delete_session,
            rename_session,
            trash_session,
            restore_session,
            fork_session,
            search_sessions,
            export_session,
            // security
            get_security,
            set_sandbox_mode,
            set_approval_policy,
            record_approval,
            clear_approval_history,
            // model
            get_models,
            set_current_model,
            set_reasoning_effort,
            upsert_provider,
            delete_provider,
            upsert_model,
            delete_model,
            test_model_connection,
            test_model,
            // git
            git_status,
            git_is_repo,
            git_init,
            git_status_changes,
            git_branches,
            git_checkout,
            git_diff,
            git_diff_cached,
            git_diff_file,
            git_discard_file,
            git_stage_hunk,
            git_unstage_hunk,
            git_commit,
            // git - 分支管理
            git_create_branch,
            git_rename_branch,
            git_delete_branch,
            // git - 远端与同步
            git_remotes,
            git_add_remote,
            git_remove_remote,
            git_fetch,
            git_push,
            git_pull,
            // git - 暂存与放弃
            git_stage_file,
            git_unstage_file,
            git_stage_all,
            git_unstage_all,
            git_discard_changes,
            // git - 提交历史
            git_log,
            git_show,
            // git - 代码审查
            git_review_diff,
            write_review_diff,
            remove_review_diff,
            // mcp
            mcp_list,
            mcp_save,
            mcp_remove,
            mcp_test,
            // skill
            skill_list,
            skill_read,
            // memory
            load_memory,
            extract_memory,
            compact_summary,
            append_project_memory,
            append_user_memory,
            write_project_memory,
            write_user_memory,
            // terminal
            resolve_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
