use crate::services::hooks::{HookRunResult, HooksConfig, HooksService, EVENTS};

/// 列出全部支持的 hook 事件（前端下拉用）
#[tauri::command]
pub fn hooks_events() -> Vec<String> {
    EVENTS.iter().map(|s| s.to_string()).collect()
}

/// 列出当前 hooks 配置
#[tauri::command]
pub fn hooks_list() -> HooksConfig {
    HooksService::load()
}

/// 新增 hook
#[tauri::command]
pub fn hooks_add(event: String, command: String, note: String) -> Result<HooksConfig, String> {
    HooksService::add(event, command, note)
}

/// 删除 hook（按 index）
#[tauri::command]
pub fn hooks_remove(index: usize) -> Result<HooksConfig, String> {
    HooksService::remove(index)
}

/// 清空 hooks
#[tauri::command]
pub fn hooks_clear() -> Result<HooksConfig, String> {
    HooksService::clear()
}

/// 测试执行一个 hook 命令（同步返回 stdout/stderr/exit）
#[tauri::command]
pub fn hooks_test(event: String, command: String) -> HookRunResult {
    HooksService::test(&event, &command)
}
