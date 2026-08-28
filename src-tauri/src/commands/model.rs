use crate::services::model::{ModelConfig, ModelConfigFile, ModelService, ProviderConfig};

/// 获取模型配置
#[tauri::command]
pub fn get_models() -> ModelConfigFile {
    ModelService::load()
}

/// 切换全局默认模型
#[tauri::command]
pub fn set_current_model(model_id: String) -> Result<ModelConfigFile, String> {
    let mut cfg = ModelService::load();
    if !cfg.models.iter().any(|m| m.id == model_id) {
        return Err(format!("模型不存在: {model_id}"));
    }
    cfg.current_model = model_id;
    ModelService::save(&cfg)?;
    Ok(cfg)
}

/// 设置推理强度 none/minimal/low/medium/high
#[tauri::command]
pub fn set_reasoning_effort(effort: String) -> Result<ModelConfigFile, String> {
    let valid = ["none", "minimal", "low", "medium", "high"];
    if !valid.contains(&effort.as_str()) {
        return Err(format!("非法推理强度: {effort}，可选 {}", valid.join("/")));
    }
    let mut cfg = ModelService::load();
    cfg.reasoning_effort = effort;
    ModelService::save(&cfg)?;
    Ok(cfg)
}

/// 新增 / 更新供应商
#[tauri::command]
pub fn upsert_provider(provider: ProviderConfig) -> Result<ModelConfigFile, String> {
    if provider.id.trim().is_empty() || provider.base_url.trim().is_empty() {
        return Err("供应商 id 与 base_url 不能为空".into());
    }
    let mut cfg = ModelService::load();
    if let Some(existing) = cfg.providers.iter_mut().find(|p| p.id == provider.id) {
        *existing = provider;
    } else {
        cfg.providers.push(provider);
    }
    ModelService::save(&cfg)?;
    Ok(cfg)
}

/// 删除供应商（同时移除其下模型）
#[tauri::command]
pub fn delete_provider(provider_id: String) -> Result<ModelConfigFile, String> {
    let mut cfg = ModelService::load();
    cfg.providers.retain(|p| p.id != provider_id);
    cfg.models.retain(|m| m.provider != provider_id);
    // 若当前模型被删除，回退到第一个模型
    if !cfg.models.iter().any(|m| m.id == cfg.current_model) {
        cfg.current_model = cfg
            .models
            .first()
            .map(|m| m.id.clone())
            .unwrap_or_default();
    }
    ModelService::save(&cfg)?;
    Ok(cfg)
}

/// 新增 / 更新模型
#[tauri::command]
pub fn upsert_model(model: ModelConfig) -> Result<ModelConfigFile, String> {
    if model.id.trim().is_empty() {
        return Err("模型 id 不能为空".into());
    }
    if !ModelService::load().providers.iter().any(|p| p.id == model.provider) {
        return Err(format!("供应商不存在: {}", model.provider));
    }
    let mut cfg = ModelService::load();
    if let Some(existing) = cfg.models.iter_mut().find(|m| m.id == model.id) {
        *existing = model;
    } else {
        cfg.models.push(model);
    }
    ModelService::save(&cfg)?;
    Ok(cfg)
}

/// 删除模型（若为当前模型则回退到第一个）
#[tauri::command]
pub fn delete_model(model_id: String) -> Result<ModelConfigFile, String> {
    let mut cfg = ModelService::load();
    cfg.models.retain(|m| m.id != model_id);
    if cfg.current_model == model_id {
        cfg.current_model = cfg
            .models
            .first()
            .map(|m| m.id.clone())
            .unwrap_or_default();
    }
    ModelService::save(&cfg)?;
    Ok(cfg)
}

/// 测试供应商连接：GET {base_url}/models 验证 key 与地址
#[tauri::command]
pub fn test_model_connection(provider_id: String) -> Result<String, String> {
    let cfg = ModelService::load();
    let provider = cfg
        .find_provider(&provider_id)
        .ok_or_else(|| format!("供应商不存在: {provider_id}"))?;
    if provider.base_url.trim().is_empty() {
        return Err("该供应商未配置 base_url".into());
    }
    let url = format!("{}/models", provider.base_url.trim_end_matches('/'));
    let mut req = ureq::get(&url).timeout(std::time::Duration::from_secs(15));
    if !provider.api_key.trim().is_empty() {
        req = req.set("Authorization", &format!("Bearer {}", provider.api_key.trim()));
    }
    let result = req.call();
    match result {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.into_string().unwrap_or_default();
            // 常见：200 成功；401/403 key 无效；404 网关地址不同
            if status == 200 {
                Ok(format!("连接成功（HTTP 200），返回 {} 字节", body.len()))
            } else if status == 401 || status == 403 {
                Err(format!("认证失败（HTTP {status}）：API Key 无效或未授权"))
            } else {
                Ok(format!("端点可达（HTTP {status}），返回 {} 字节", body.len()))
            }
        }
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            if code == 401 || code == 403 {
                Err(format!("认证失败（HTTP {code}）：API Key 无效或未授权"))
            } else if code == 404 {
                Err(format!("端点 404：base_url 可能不正确（HTTP {code}）"))
            } else {
                Err(format!("HTTP {code}：{}", truncate(&body, 200)))
            }
        }
        Err(ureq::Error::Transport(t)) => {
            Err(format!("无法连接：{}", t))
        }
    }
}

/// 测试单个模型是否可用：对该模型发一个最小对话请求（POST {base_url}/chat/completions）
#[tauri::command]
pub fn test_model(model_id: String) -> Result<String, String> {
    let cfg = ModelService::load();
    let model = cfg
        .models
        .iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| format!("模型不存在: {model_id}"))?;
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
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 16,
    });
    let mut req = ureq::post(&url)
        .timeout(std::time::Duration::from_secs(60))
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
                let reply = parsed["choices"][0]["message"]["content"]
                    .as_str()
                    .unwrap_or("(无法解析回复)")
                    .to_string();
                Ok(format!("模型可用，回复：{}", truncate(&reply, 80)))
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

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}
