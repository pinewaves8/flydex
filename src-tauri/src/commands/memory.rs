use crate::services::memory::MemoryService;

/// 记忆提炼系统提示词：从会话中抽取高价值、可复用的记忆
const EXTRACT_SYSTEM: &str = r#"你是 Flydex 的记忆提炼助手。从用户提供的会话记录中，提取值得沉淀到项目记忆的内容。
只提取高价值、可复用、明确的信息，例如：
- 项目技术决策（选型、架构约定、接口约定）
- 踩过的坑与规避方法
- 常用命令或流程
忽略闲聊、寒暄、与项目无关的内容。
严格输出 JSON 数组，不要输出任何解释或 markdown 代码块标记。每个元素格式：
{"section":"活跃约定|决策记录|踩坑与规避|常用命令","title":"简短标题","content":"一句话要点","confidence":0到1的小数}
如果没有可提取内容，输出 []。"#;

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

/// 从会话文本中提取可沉淀的记忆候选（调用当前配置的模型）
///
/// 复用 ModelService 当前模型 + 供应商配置，向 chat/completions 发送提取指令，
/// 期望返回 JSON 数组 `[{section, title, content, confidence}]`。
/// 模型输出可能包裹在 ```json 代码块中，会做清理后解析；解析失败时返回 {"raw": ...}。
#[tauri::command]
pub fn extract_memory(session_text: String) -> Result<serde_json::Value, String> {
    use crate::services::model::ModelService;
    let cfg = ModelService::load();
    let model_id = cfg.current_model.clone();
    let model = cfg
        .find_model(&model_id)
        .ok_or_else(|| format!("当前模型不存在: {model_id}"))?;
    let provider = cfg
        .find_provider(&model.provider)
        .ok_or_else(|| format!("供应商不存在: {}", model.provider))?;
    if provider.base_url.trim().is_empty() {
        return Err("该供应商未配置 base_url".into());
    }
    let url = format!(
        "{}/chat/completions",
        provider.base_url.trim_end_matches('/')
    );
    let body = serde_json::json!({
        "model": model.id,
        "messages": [
            {"role": "system", "content": EXTRACT_SYSTEM},
            {"role": "user", "content": session_text}
        ],
        "max_tokens": 2048,
        "temperature": 0.2,
    });
    let mut req = ureq::post(&url)
        .timeout(std::time::Duration::from_secs(90))
        .set("Content-Type", "application/json");
    if !provider.api_key.trim().is_empty() {
        req = req.set("Authorization", &format!("Bearer {}", provider.api_key.trim()));
    }
    match req.send_json(body) {
        Ok(resp) => {
            let status = resp.status();
            let text = resp.into_string().unwrap_or_default();
            if status == 200 {
                let parsed: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
                let content = parsed["choices"][0]["message"]["content"]
                    .as_str()
                    .unwrap_or("[]")
                    .to_string();
                let cleaned = strip_code_fence(&content);
                match serde_json::from_str::<serde_json::Value>(&cleaned) {
                    Ok(v) => Ok(v),
                    Err(_) => Ok(serde_json::json!({ "raw": content })),
                }
            } else {
                Err(format!("HTTP {status}：{}", truncate(&text, 200)))
            }
        }
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            Err(format!("HTTP {code}：{}", truncate(&body, 200)))
        }
        Err(ureq::Error::Transport(t)) => Err(format!("无法连接：{}", t)),
    }
}

/// 去掉模型输出包裹的 ```json ... ``` 代码块标记
fn strip_code_fence(s: &str) -> String {
    let t = s.trim();
    let t = t
        .strip_prefix("```json")
        .or_else(|| t.strip_prefix("```"))
        .unwrap_or(t);
    let t = t.strip_suffix("```").unwrap_or(t);
    t.trim().to_string()
}

/// 截断到 max 字符（用于错误信息）
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}
