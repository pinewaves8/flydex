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
    git_rename_branch, git_review_diff, git_show, git_stage_all, git_stage_file, git_stage_hunk,
    git_status, git_status_changes, git_unstage_all, git_unstage_file, git_unstage_hunk,
    remove_review_diff, write_review_diff,
};
use commands::hooks::{hooks_add, hooks_clear, hooks_events, hooks_list, hooks_remove, hooks_test};
use commands::init::{
    init_clear_state, init_get_state, init_mark_written, init_scan, init_set_state,
    init_validate_agents, init_write_file,
};
use commands::mcp::{mcp_list, mcp_remove, mcp_save, mcp_test};
use commands::memory::{
    append_project_memory, append_user_memory, compact_summary, extract_memory, load_memory,
    write_project_memory, write_user_memory,
};
use commands::model::{
    delete_model, delete_provider, get_models, set_current_model, set_reasoning_effort, test_model,
    test_model_connection, upsert_model, upsert_provider,
};
use commands::project::{create_project, delete_project, list_projects, update_project};
use commands::security::{
    add_permission_rule, clear_approval_history, clear_permission_rules, get_security,
    list_permission_rules, record_approval, remove_permission_rule, security_test_rule,
    set_approval_policy, set_auto_checkpoint, set_sandbox_mode,
};
use commands::session::{
    create_session, delete_session, export_session, fork_session, list_sessions,
    list_trashed_sessions, load_session, rename_session, restore_session, save_session,
    search_messages, search_sessions, trash_session,
};
use commands::skill::{
    skill_create, skill_delete, skill_import, skill_list, skill_read, skill_validate,
};
use commands::task::{task_create, task_delete, task_list, task_update};
use commands::terminal::resolve_dir;
use commands::thread::{
    archive_thread, delete_thread, list_threads, load_earlier_turns, load_thread_turns,
    project_map_entries, read_thread, rename_thread, search_thread_occurrences, search_threads,
    sync_projects, unarchive_thread,
};
use commands::workspace::{list_directory, list_files};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 调试时打开 devtools（仅 debug 构建），用环境变量开关，默认关闭保持干净窗口
            // 用法: FLYDEX_DEVTOOLS=1 pnpm tauri dev
            #[cfg(debug_assertions)]
            {
                if std::env::var("FLYDEX_DEVTOOLS").ok().as_deref() == Some("1") {
                    use tauri::Manager;
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.open_devtools();
                    }
                }
            }
            Ok(())
        })
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
            search_messages,
            export_session,
            // task
            task_list,
            task_create,
            task_update,
            task_delete,
            // workspace
            list_directory,
            list_files,
            // thread(codex 原生会话)
            sync_projects,
            project_map_entries,
            list_threads,
            read_thread,
            load_thread_turns,
            load_earlier_turns,
            rename_thread,
            archive_thread,
            unarchive_thread,
            delete_thread,
            search_threads,
            search_thread_occurrences,
            // security
            get_security,
            set_sandbox_mode,
            set_approval_policy,
            set_auto_checkpoint,
            record_approval,
            clear_approval_history,
            // permission rules
            add_permission_rule,
            remove_permission_rule,
            list_permission_rules,
            clear_permission_rules,
            security_test_rule,
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
            // hooks
            hooks_events,
            hooks_list,
            hooks_add,
            hooks_remove,
            hooks_clear,
            hooks_test,
            // init
            init_scan,
            init_write_file,
            init_get_state,
            init_set_state,
            init_clear_state,
            init_mark_written,
            init_validate_agents,
            // skill
            skill_list,
            skill_read,
            skill_validate,
            skill_import,
            skill_create,
            skill_delete,
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
