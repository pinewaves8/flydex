use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::services::storage::Storage;

/// 沙箱模式（对应 codex `-c sandbox_mode=...`）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxMode {
    /// 只读：AI 无法写文件/执行写操作
    ReadOnly,
    /// 工作区写入：允许在项目目录内写操作
    WorkspaceWrite,
    /// 完全访问：无沙箱，真实用户权限
    DangerFullAccess,
}

impl SandboxMode {
    pub fn as_codex(&self) -> &'static str {
        match self {
            SandboxMode::ReadOnly => "read-only",
            SandboxMode::WorkspaceWrite => "workspace-write",
            SandboxMode::DangerFullAccess => "danger-full-access",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            SandboxMode::ReadOnly => "只读",
            SandboxMode::WorkspaceWrite => "工作区写入",
            SandboxMode::DangerFullAccess => "完全访问",
        }
    }
}

/// 审批策略（对应 codex `-c approval_policy=...`）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalPolicy {
    /// 不可信命令才询问
    Untrusted,
    /// 模型按需请求审批（默认）
    OnRequest,
    /// 永不询问（自动放行）
    Never,
}

impl ApprovalPolicy {
    pub fn as_codex(&self) -> &'static str {
        match self {
            ApprovalPolicy::Untrusted => "untrusted",
            ApprovalPolicy::OnRequest => "on-request",
            ApprovalPolicy::Never => "never",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            ApprovalPolicy::Untrusted => "询问不可信操作",
            ApprovalPolicy::OnRequest => "按需请求",
            ApprovalPolicy::Never => "自动放行",
        }
    }
}

/// 审批历史记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRecord {
    pub id: String,
    pub timestamp: i64,
    pub command: String,
    pub approved: bool,
    pub run_id: String,
}

/// 安全配置（持久化到 ~/.flydex/security.json）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityConfig {
    pub sandbox_mode: SandboxMode,
    pub approval_policy: ApprovalPolicy,
    /// 审批历史（最多保留 200 条）
    pub history: Vec<ApprovalRecord>,
}

impl Default for SecurityConfig {
    fn default() -> Self {
        // Windows 上 workspace-write 沙箱使用降权用户（CodexSandboxOffline）运行命令，
        // 对 .git 目录写入受限导致 git add/commit 失败。为保证 AI 能自然语言完成
        // git 写操作，默认使用 danger-full-access（真实权限）+ on-request 审批兜底。
        Self {
            sandbox_mode: SandboxMode::DangerFullAccess,
            approval_policy: ApprovalPolicy::OnRequest,
            history: Vec::new(),
        }
    }
}

/// 安全配置管理服务
pub struct SecurityService;

impl SecurityService {
    fn file() -> PathBuf {
        Storage::app_dir().join("security.json")
    }

    /// 读取安全配置（文件不存在/损坏时返回默认值）
    pub fn load() -> SecurityConfig {
        let path = Self::file();
        if !path.exists() {
            return SecurityConfig::default();
        }
        fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    }

    fn save(config: &SecurityConfig) -> std::io::Result<()> {
        fs::create_dir_all(Storage::app_dir())?;
        let content = serde_json::to_string_pretty(config).unwrap_or_default();
        fs::write(Self::file(), content)
    }

    /// 更新沙箱模式
    pub fn set_sandbox_mode(mode: SandboxMode) -> std::io::Result<SecurityConfig> {
        let mut config = Self::load();
        config.sandbox_mode = mode;
        Self::save(&config)?;
        Ok(config)
    }

    /// 更新审批策略
    pub fn set_approval_policy(policy: ApprovalPolicy) -> std::io::Result<SecurityConfig> {
        let mut config = Self::load();
        config.approval_policy = policy;
        Self::save(&config)?;
        Ok(config)
    }

    /// 追加审批历史（保留最近 200 条）
    pub fn add_history(record: ApprovalRecord) -> std::io::Result<SecurityConfig> {
        let mut config = Self::load();
        config.history.push(record);
        if config.history.len() > 200 {
            let overflow = config.history.len() - 200;
            config.history.drain(..overflow);
        }
        Self::save(&config)?;
        Ok(config)
    }

    /// 清空审批历史
    pub fn clear_history() -> std::io::Result<SecurityConfig> {
        let mut config = Self::load();
        config.history.clear();
        Self::save(&config)?;
        Ok(config)
    }
}
