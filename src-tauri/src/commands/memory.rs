use crate::services::memory::MemoryService;

/// 加载记忆（用户级 + 项目级），供前端展示与注入预览
#[tauri::command]
pub fn load_memory(workdir: Option<String>) -> serde_json::Value {
    let user = MemoryService::load_user_memory();
    let project = match &workdir {
        Some(w) if !w.trim().is_empty() => MemoryService::load_project_memory(w),
        _ => String::new(),
    };
    serde_json::json!({
        "user": user,
        "project": project,
        "user_file": MemoryService::user_memory_file().display().to_string(),
        "project_file": match &workdir {
            Some(w) if !w.trim().is_empty() => MemoryService::project_memory_file(w).display().to_string(),
            _ => String::new(),
        },
    })
}

/// 向项目记忆追加一条沉淀记录
#[tauri::command]
pub fn append_project_memory(
    workdir: String,
    section: String,
    content: String,
    source: Option<String>,
) -> Result<(), String> {
    MemoryService::append_memory(
        &MemoryService::project_memory_file(&workdir),
        &section,
        &content,
        source.as_deref().unwrap_or("manual"),
    )
}

/// 向用户记忆追加一条沉淀记录
#[tauri::command]
pub fn append_user_memory(
    section: String,
    content: String,
    source: Option<String>,
) -> Result<(), String> {
    MemoryService::append_memory(
        &MemoryService::user_memory_file(),
        &section,
        &content,
        source.as_deref().unwrap_or("manual"),
    )
}

/// 覆盖写入项目记忆（记忆管理面板编辑用）
#[tauri::command]
pub fn write_project_memory(workdir: String, content: String) -> Result<(), String> {
    MemoryService::write_memory(&MemoryService::project_memory_file(&workdir), &content)
}

/// 覆盖写入用户记忆（记忆管理面板编辑用）
#[tauri::command]
pub fn write_user_memory(content: String) -> Result<(), String> {
    MemoryService::write_memory(&MemoryService::user_memory_file(), &content)
}
