use std::fs;
use std::path::PathBuf;

use crate::models::task::{priority, status, Task};

/// 任务持久化服务（7.4.2 Tasks API）
///
/// 全局任务存储于 ~/.flydex/tasks.json，可关联 project_id / session_id。
/// 支持注入 data_dir 便于单测隔离。
pub struct TasksService {
    data_dir: PathBuf,
}

impl Default for TasksService {
    fn default() -> Self {
        Self::new()
    }
}

impl TasksService {
    /// 默认数据目录（~/.flydex）
    pub fn new() -> Self {
        let dir = crate::services::storage::Storage::app_dir();
        Self { data_dir: dir }
    }

    /// 注入数据目录（测试用）
    pub fn with_dir(dir: PathBuf) -> Self {
        Self { data_dir: dir }
    }

    fn tasks_file(&self) -> PathBuf {
        self.data_dir.join("tasks.json")
    }

    fn read_all(&self) -> Vec<Task> {
        let path = self.tasks_file();
        if !path.exists() {
            return Vec::new();
        }
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    }

    fn write_all(&self, tasks: &[Task]) -> Result<(), String> {
        fs::create_dir_all(&self.data_dir).map_err(|e| e.to_string())?;
        let content = serde_json::to_string_pretty(tasks).map_err(|e| e.to_string())?;
        fs::write(self.tasks_file(), content).map_err(|e| e.to_string())
    }

    fn now_ms() -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    fn uuid_simple() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("{:x}", nanos)
    }

    /// 列出任务；project_id 传入则按项目过滤，未传返回全部。按 updated_at 倒序。
    pub fn list(&self, project_id: Option<&str>) -> Vec<Task> {
        let mut tasks = self.read_all();
        if let Some(pid) = project_id {
            if !pid.trim().is_empty() {
                tasks.retain(|t| t.project_id.as_deref() == Some(pid));
            }
        }
        tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        tasks
    }

    /// 创建任务
    pub fn create(
        &self,
        title: String,
        description: String,
        pri: String,
        project_id: Option<String>,
        session_id: Option<String>,
        labels: Vec<String>,
    ) -> Result<Task, String> {
        let title = title.trim();
        if title.is_empty() {
            return Err("任务标题不能为空".into());
        }
        let pri = if priority::is_valid(&pri) { pri } else { priority::MEDIUM.to_string() };
        let now = Self::now_ms();
        let task = Task::new(
            format!("task_{}", Self::uuid_simple()),
            title.to_string(),
            description,
            pri,
            project_id,
            session_id,
            labels,
            now,
        );
        let mut all = self.read_all();
        all.push(task.clone());
        self.write_all(&all)?;
        Ok(task)
    }

    /// 更新任务；None 字段保持不变。status 非法时报错。
    pub fn update(
        &self,
        id: &str,
        title: Option<String>,
        description: Option<String>,
        st: Option<String>,
        pri: Option<String>,
        labels: Option<Vec<String>>,
    ) -> Result<Task, String> {
        let mut all = self.read_all();
        let task = all
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or_else(|| format!("Task not found: {}", id))?;
        if let Some(t) = title {
            let t = t.trim();
            if t.is_empty() {
                return Err("任务标题不能为空".into());
            }
            task.title = t.to_string();
        }
        if let Some(d) = description {
            task.description = d;
        }
        if let Some(s) = st {
            if !status::is_valid(&s) {
                return Err(format!("非法任务状态: {}", s));
            }
            task.status = s;
        }
        if let Some(p) = pri {
            task.priority = if priority::is_valid(&p) { p } else { priority::MEDIUM.to_string() };
        }
        if let Some(l) = labels {
            task.labels = l;
        }
        task.updated_at = Self::now_ms();
        let updated = task.clone();
        self.write_all(&all)?;
        Ok(updated)
    }

    /// 删除任务
    pub fn delete(&self, id: &str) -> Result<(), String> {
        let all = self.read_all();
        let filtered: Vec<Task> = all.into_iter().filter(|t| t.id != id).collect();
        if filtered.len() == self.read_all().len() {
            return Err(format!("Task not found: {}", id));
        }
        self.write_all(&filtered)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("flydex_tasks_test_{}_{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn create_list_filter() {
        let dir = temp_dir("create");
        let svc = TasksService::with_dir(dir.clone());
        let a = svc
            .create("写报告".into(), "周报".into(), "high".into(), Some("p1".into()), None, vec!["docs".into()])
            .unwrap();
        let b = svc
            .create("修 bug".into(), String::new(), "medium".into(), Some("p2".into()), None, vec![])
            .unwrap();
        assert_eq!(svc.list(None).len(), 2);
        assert_eq!(svc.list(Some("p1")).len(), 1);
        assert_eq!(svc.list(Some("p1"))[0].id, a.id);
        // 空标题拒绝
        assert!(svc.create("   ".into(), String::new(), "low".into(), None, None, vec![]).is_err());
        let _ = b;
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn update_status_and_persist() {
        let dir = temp_dir("update");
        let svc = TasksService::with_dir(dir.clone());
        let t = svc.create("任务".into(), String::new(), "low".into(), None, None, vec![]).unwrap();
        // 更新状态 + 标题
        let upd = svc.update(&t.id, Some("新标题".into()), None, Some("done".into()), None, None).unwrap();
        assert_eq!(upd.status, "done");
        assert_eq!(upd.title, "新标题");
        // 持久化：重建服务实例后仍存在
        let svc2 = TasksService::with_dir(dir.clone());
        let reloaded = svc2.list(None);
        assert_eq!(reloaded.len(), 1);
        assert_eq!(reloaded[0].status, "done");
        // 非法状态拒绝
        assert!(svc.update(&t.id, None, None, Some("bogus".into()), None, None).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_task() {
        let dir = temp_dir("delete");
        let svc = TasksService::with_dir(dir.clone());
        let a = svc.create("a".into(), String::new(), "low".into(), None, None, vec![]).unwrap();
        let b = svc.create("b".into(), String::new(), "low".into(), None, None, vec![]).unwrap();
        svc.delete(&a.id).unwrap();
        assert_eq!(svc.list(None).len(), 1);
        assert_eq!(svc.list(None)[0].id, b.id);
        // 删除不存在任务报错
        assert!(svc.delete("nope").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sort_by_updated_desc() {
        let dir = temp_dir("sort");
        let svc = TasksService::with_dir(dir.clone());
        let a = svc.create("a".into(), String::new(), "low".into(), None, None, vec![]).unwrap();
        let b = svc.create("b".into(), String::new(), "low".into(), None, None, vec![]).unwrap();
        // 更新 a → a 应排到最前
        svc.update(&a.id, Some("a2".into()), None, None, None, None).unwrap();
        assert_eq!(svc.list(None)[0].id, a.id);
        let _ = b;
        let _ = fs::remove_dir_all(&dir);
    }
}
