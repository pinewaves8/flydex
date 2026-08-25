//! Flydex - Tauri application backend

mod commands;
mod models;
mod services;
mod types;
mod utils;

use commands::codex::run_codex;
use commands::project::{create_project, delete_project, list_projects, update_project};
use commands::session::{
    create_session, delete_session, list_sessions, load_session, rename_session, save_session,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            run_codex,
            // project
            list_projects,
            create_project,
            update_project,
            delete_project,
            // session
            list_sessions,
            load_session,
            create_session,
            save_session,
            delete_session,
            rename_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
