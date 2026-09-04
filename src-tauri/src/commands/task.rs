use crate::models::task::Task;
use crate::services::tasks::TasksService;

/// 列出任务（可按项目过滤；未传 project_id 返回全部，按更新时间倒序）
#[tauri::command]
pub fn task_list(project_id: Option<String>) -> Vec<Task> {
    let svc = TasksService::new();
    svc.list(project_id.as_deref())
}

/// 创建任务
#[tauri::command]
pub fn task_create(
    title: String,
    description: Option<String>,
    priority: Option<String>,
    project_id: Option<String>,
    session_id: Option<String>,
    labels: Option<Vec<String>>,
) -> Result<Task, String> {
    let svc = TasksService::new();
    svc.create(
        title,
        description.unwrap_or_default(),
        priority.unwrap_or_else(|| "medium".into()),
        project_id,
        session_id,
        labels.unwrap_or_default(),
    )
}

/// 更新任务（None 字段保持不变；status 非法报错）
#[tauri::command]
pub fn task_update(
    id: String,
    title: Option<String>,
    description: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    labels: Option<Vec<String>>,
) -> Result<Task, String> {
    let svc = TasksService::new();
    svc.update(&id, title, description, status, priority, labels)
}

/// 删除任务
#[tauri::command]
pub fn task_delete(id: String) -> Result<(), String> {
    let svc = TasksService::new();
    svc.delete(&id)
}
