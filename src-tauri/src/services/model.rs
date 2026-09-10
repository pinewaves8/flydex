use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 供应商配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
}

/// 模型配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub id: String,
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
}

/// 模型配置文件（~/.flydex/models.json）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfigFile {
    #[serde(default)]
    pub providers: Vec<ProviderConfig>,
    #[serde(default)]
    pub models: Vec<ModelConfig>,
    #[serde(default)]
    pub current_model: String,
    /// none / minimal / low / medium / high
    #[serde(default)]
    pub reasoning_effort: String,
}

impl Default for ModelConfigFile {
    fn default() -> Self {
        seed_config()
    }
}

impl ModelConfigFile {
    pub fn find_provider(&self, id: &str) -> Option<&ProviderConfig> {
        self.providers.iter().find(|p| p.id == id)
    }

    pub fn find_model(&self, id: &str) -> Option<&ModelConfig> {
        self.models.iter().find(|m| m.id == id)
    }
}

/// 内置模型：OpenAI 官方系 + MiniMax + Qwen + DeepSeek + Ollama（本地）
fn seed_config() -> ModelConfigFile {
    let providers = vec![
        ProviderConfig {
            // 注意：`openai` 是 codex 保留内置 provider ID，不能作为自定义 provider 覆盖，
            // 用 `openai-official` 作为可覆盖的自定义 ID。
            id: "openai-official".into(),
            name: "OpenAI".into(),
            base_url: "https://api.openai.com/v1".into(),
            api_key: String::new(),
        },
        ProviderConfig {
            id: "minimax".into(),
            name: "MiniMax".into(),
            base_url: "https://api.minimaxi.com/v1".into(),
            api_key: String::new(),
        },
        ProviderConfig {
            id: "qwen".into(),
            name: "阿里云 Qwen".into(),
            base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1".into(),
            api_key: String::new(),
        },
        ProviderConfig {
            id: "deepseek".into(),
            name: "DeepSeek".into(),
            base_url: "https://api.deepseek.com/v1".into(),
            api_key: String::new(),
        },
        ProviderConfig {
            // `ollama` 同样是 codex 保留内置 ID，改用 `ollama-local`。
            // 注意：必须用 127.0.0.1 而非 localhost——Windows 上 ollama 只监听
            // IPv4，localhost 可能解析为 ::1 导致连接超时（os error 10060）。
            id: "ollama-local".into(),
            name: "Ollama（本地）".into(),
            base_url: "http://127.0.0.1:11434/v1".into(),
            api_key: String::new(),
        },
    ];
    let models = vec![
        // OpenAI 官方系
        ModelConfig {
            id: "gpt-5.5".into(),
            provider: "openai-official".into(),
            context_window: Some(400000),
        },
        ModelConfig {
            id: "gpt-5.2".into(),
            provider: "openai-official".into(),
            context_window: Some(400000),
        },
        ModelConfig {
            id: "gpt-5-mini".into(),
            provider: "openai-official".into(),
            context_window: Some(200000),
        },
        ModelConfig {
            id: "o3".into(),
            provider: "openai-official".into(),
            context_window: Some(200000),
        },
        ModelConfig {
            id: "o4-mini".into(),
            provider: "openai-official".into(),
            context_window: Some(200000),
        },
        // MiniMax
        ModelConfig {
            id: "MiniMax-M2.7-highspeed".into(),
            provider: "minimax".into(),
            context_window: Some(204800),
        },
        // Qwen
        ModelConfig {
            id: "qwen-max".into(),
            provider: "qwen".into(),
            context_window: Some(131072),
        },
        ModelConfig {
            id: "qwen3-coder-plus".into(),
            provider: "qwen".into(),
            context_window: Some(262144),
        },
        // DeepSeek
        ModelConfig {
            id: "deepseek-chat".into(),
            provider: "deepseek".into(),
            context_window: Some(131072),
        },
        ModelConfig {
            id: "deepseek-reasoner".into(),
            provider: "deepseek".into(),
            context_window: Some(131072),
        },
        // Ollama（本地）：仅内置本机常见的模型（用户需先 `ollama pull` 才能用）。
        // 注意：不要内置不存在的 tag（如 qwen2.5:7b）误导用户，本机实际以 `ollama list` 为准，
        // 缺失的模型可在设置页"模型配置"里自行增删。
        ModelConfig {
            id: "qwen2.5-coder:latest".into(),
            provider: "ollama-local".into(),
            context_window: None,
        },
        ModelConfig {
            id: "qwen2.5:0.5b".into(),
            provider: "ollama-local".into(),
            context_window: None,
        },
        ModelConfig {
            id: "qwen2.5vl:3b".into(),
            provider: "ollama-local".into(),
            context_window: None,
        },
        ModelConfig {
            id: "qwen3:0.6b".into(),
            provider: "ollama-local".into(),
            context_window: None,
        },
    ];
    let mut cfg = ModelConfigFile {
        providers,
        models,
        current_model: "MiniMax-M2.7-highspeed".into(),
        reasoning_effort: "none".into(),
    };
    // 尝试从 ~/.codex/config.toml 继承 MiniMax 供应商的 base_url / api_key
    inherit_from_codex_config(&mut cfg);
    cfg
}

/// 从 ~/.codex/config.toml 继承已配置的供应商（避免用户重填 key）
fn inherit_from_codex_config(cfg: &mut ModelConfigFile) {
    let Some(home) = dirs::home_dir() else { return };
    let path = home.join(".codex").join("config.toml");
    let Ok(text) = fs::read_to_string(&path) else {
        return;
    };
    let Ok(v) = text.parse::<toml::Value>() else {
        return;
    };

    // 顶层 model_provider / model
    if let Some(toml::Value::String(pid)) = v.get("model_provider") {
        if let Some(toml::Value::String(model)) = v.get("model") {
            cfg.current_model = model.clone();
            // 确保 current_model 在 models 里
            if !cfg.models.iter().any(|m| m.id == *model) {
                cfg.models.push(ModelConfig {
                    id: model.clone(),
                    provider: pid.clone(),
                    context_window: None,
                });
            }
        }
    }

    // model_providers.<id>
    if let Some(toml::Value::Table(providers)) = v.get("model_providers") {
        for (id, val) in providers {
            let Some(t) = val.as_table() else { continue };
            let name = t
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or(id)
                .to_string();
            let base_url = t
                .get("base_url")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let api_key = t
                .get("experimental_bearer_token")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            if let Some(existing) = cfg.providers.iter_mut().find(|p| p.id == *id) {
                if !base_url.is_empty() {
                    existing.base_url = base_url;
                }
                if !api_key.is_empty() {
                    existing.api_key = api_key;
                }
                if existing.name.is_empty() {
                    existing.name = name;
                }
            } else {
                cfg.providers.push(ProviderConfig {
                    id: id.clone(),
                    name,
                    base_url,
                    api_key,
                });
            }
        }
    }
}

// —— 持久化 ——

fn config_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(home.join(".flydex").join("models.json"))
}

/// `ModelService::thread_config` 的纯实现(便于单测,不读磁盘)
fn build_thread_config(
    cfg: &ModelConfigFile,
    model_override: Option<&str>,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    let model_id = model_override
        .filter(|s| !s.is_empty())
        .unwrap_or(&cfg.current_model);
    let model = cfg.find_model(model_id)?;
    let provider = cfg.find_provider(&model.provider)?;

    let provider_id = format!("flydex_{}", provider.id);
    let mut provider_table = serde_json::json!({
        "name": provider.name,
        "base_url": provider.base_url,
    });
    // codex 的 ModelProviderInfo 只认 responses 协议（chat 已被移除），默认即 responses
    if !provider.api_key.is_empty() {
        provider_table["experimental_bearer_token"] =
            serde_json::Value::String(provider.api_key.clone());
    }

    let mut out = serde_json::Map::new();
    out.insert("model".into(), serde_json::Value::String(model.id.clone()));
    out.insert(
        "model_provider".into(),
        serde_json::Value::String(provider_id.clone()),
    );
    out.insert(format!("model_providers.{provider_id}"), provider_table);
    Some(out)
}

pub struct ModelService;

impl ModelService {
    pub fn load() -> ModelConfigFile {
        let Some(path) = config_path() else {
            return seed_config();
        };
        match fs::read_to_string(&path) {
            Ok(text) => {
                let mut cfg: ModelConfigFile =
                    serde_json::from_str(&text).unwrap_or_else(|_| seed_config());
                let changed = migrate_reserved_ids(&mut cfg) | ensure_builtin(&mut cfg);
                if changed {
                    let _ = Self::save(&cfg);
                }
                cfg
            }
            Err(_) => {
                let cfg = seed_config();
                let _ = Self::save(&cfg);
                cfg
            }
        }
    }

    /// 构造 codex `thread/start`（及 `thread/resume`）的 `config` 覆盖表。
    ///
    /// 为什么走这条路而不是改写 `~/.codex/config.toml`:
    /// codex 支持按 thread 传 config 层（优先级高于全局 config.toml），因此
    /// **不需要碰用户的 Codex CLI 全局配置**，也不需要重启 daemon —— 换模型只是下一个
    /// thread 的参数不同。resume 同样带这份 config，所以不会出现「线程绑死旧 provider →
    /// 拿新模型名去请求旧厂商 → unknown model」。
    ///
    /// 返回形如:
    /// ```json
    /// {
    ///   "model": "deepseek-v4-flash",
    ///   "model_provider": "flydex_deepseek",
    ///   "model_providers.flydex_deepseek": {
    ///     "name": "DeepSeek",
    ///     "base_url": "https://api.deepseek.com/v1",
    ///     "experimental_bearer_token": "sk-..."
    ///   }
    /// }
    /// ```
    /// provider id 加 `flydex_` 前缀，避免与用户自己在 config.toml 里的定义撞名。
    pub fn thread_config(
        model_override: Option<&str>,
    ) -> Option<serde_json::Map<String, serde_json::Value>> {
        build_thread_config(&Self::load(), model_override)
    }

    pub fn save(cfg: &ModelConfigFile) -> Result<(), String> {
        let Some(path) = config_path() else {
            return Err("无法定位 ~/.flydex 目录".into());
        };
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
        fs::write(&path, json).map_err(|e| e.to_string())
    }

    /// 当前生效的 (模型, 供应商)
    #[allow(dead_code)]
    pub fn current() -> Option<(ModelConfig, ProviderConfig)> {
        let cfg = Self::load();
        let model = cfg.find_model(&cfg.current_model).cloned()?;
        let provider = cfg.find_provider(&model.provider).cloned()?;
        Some((model, provider))
    }
}

/// 迁移：codex 的 `openai` / `ollama` 是保留内置 provider ID，不允许自定义覆盖。
/// 将旧配置文件中的这两个 ID 改名为可覆盖的 `openai-official` / `ollama-local`。
fn migrate_reserved_ids(cfg: &mut ModelConfigFile) -> bool {
    let mut changed = false;
    for p in cfg.providers.iter_mut() {
        if p.id == "openai" {
            p.id = "openai-official".into();
            changed = true;
        } else if p.id == "ollama" {
            p.id = "ollama-local".into();
            changed = true;
        }
    }
    for m in cfg.models.iter_mut() {
        if m.provider == "openai" {
            m.provider = "openai-official".into();
            changed = true;
        } else if m.provider == "ollama" {
            m.provider = "ollama-local".into();
            changed = true;
        }
    }
    changed
}

/// 迁移：确保新增的内置供应商（如 Ollama）在已生成的 models.json 中补入。
/// 只做"缺失则补"，不删除、不覆盖用户已有的自定义配置。返回是否发生了变更。
fn ensure_builtin(cfg: &mut ModelConfigFile) -> bool {
    let builtin = seed_config();
    let mut changed = false;
    for p in builtin.providers {
        if !cfg.providers.iter().any(|x| x.id == p.id) {
            cfg.providers.push(p);
            changed = true;
        }
    }
    for m in builtin.models {
        if !cfg.models.iter().any(|x| x.id == m.id) {
            cfg.models.push(m);
            changed = true;
        }
    }
    changed
}

/// 在 codex config.toml 文本中写入 model / model_provider / [model_providers.<id>]
///
/// **关键**:TOML 的顶层键必须出现在**任何 `[table]` 之前**。
/// 早期实现把 `model = ...` 追加到文件末尾 —— 那会落进最后一个 `[projects.x]` 表内部,
/// 导致 codex 读不到顶层 model,静默回退到内置默认模型(表现为「模型切换无效、输出为空」)。
///
/// 因此这里:先把顶层键写到文件**开头**,再输出其余内容(剔除旧的 model 相关键)。

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg_with(model_id: &str, provider_id: &str, key: &str) -> ModelConfigFile {
        ModelConfigFile {
            providers: vec![ProviderConfig {
                id: provider_id.into(),
                name: "DeepSeek".into(),
                base_url: "https://api.deepseek.com/v1".into(),
                api_key: key.into(),
            }],
            models: vec![ModelConfig {
                id: model_id.into(),
                provider: provider_id.into(),
                context_window: Some(131072),
            }],
            current_model: model_id.into(),
            reasoning_effort: String::new(),
        }
    }

    /// 回归:thread_config 必须把 model + model_provider + 供应商表一起给全。
    /// 只给 model 不给 provider,正是「切模型无效 / unknown model」的成因。
    #[test]
    fn thread_config_carries_model_and_provider_together() {
        let cfg = cfg_with("deepseek-v4-flash", "deepseek", "sk-test");
        let map = build_thread_config(&cfg, None).expect("应生成 config");

        assert_eq!(map["model"], serde_json::json!("deepseek-v4-flash"));
        assert_eq!(map["model_provider"], serde_json::json!("flydex_deepseek"));

        let p = &map["model_providers.flydex_deepseek"];
        assert_eq!(p["name"], serde_json::json!("DeepSeek"));
        assert_eq!(p["base_url"], serde_json::json!("https://api.deepseek.com/v1"));
        assert_eq!(p["experimental_bearer_token"], serde_json::json!("sk-test"));
    }

    /// 会话级覆盖优先于全局当前模型
    #[test]
    fn thread_config_honours_session_override() {
        let mut cfg = cfg_with("deepseek-v4-flash", "deepseek", "sk-test");
        cfg.models.push(ModelConfig {
            id: "deepseek-reasoner".into(),
            provider: "deepseek".into(),
            context_window: None,
        });
        let map = build_thread_config(&cfg, Some("deepseek-reasoner")).unwrap();
        assert_eq!(map["model"], serde_json::json!("deepseek-reasoner"));
    }

    /// 空串覆盖视为「未覆盖」
    #[test]
    fn thread_config_ignores_empty_override() {
        let cfg = cfg_with("m1", "p1", "");
        let map = build_thread_config(&cfg, Some("")).unwrap();
        assert_eq!(map["model"], serde_json::json!("m1"));
        // 空 api_key 不应写入 token 字段
        assert!(map["model_providers.flydex_p1"].get("experimental_bearer_token").is_none());
    }

    /// 未知模型/供应商 → None(调用方回退到 codex 自身配置,而不是发一个错的 provider)
    #[test]
    fn thread_config_returns_none_for_unknown_model() {
        let cfg = cfg_with("m1", "p1", "k");
        assert!(build_thread_config(&cfg, Some("nope")).is_none());
    }
}
