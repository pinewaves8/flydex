//! Flydex - Tauri application backend

mod commands;
mod models;
mod services;
mod types;
mod utils;

use commands::codex::run_codex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![run_codex])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
