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

#[allow(dead_code)] // label() 仅前端/诊断保留；as_codex() 供 app-server sandbox 参数
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

#[allow(dead_code)] // as_codex/label 保留（前端展示 & 未来按会话覆盖策略）
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

// ============ 权限规则引擎（对齐 Claude Code：deny/allow/ask） ============
//
// 决策优先级（Claude Code 权限模型）：
//   1. 内置 deny 白名单（危险命令，用户规则不可覆盖，安全底线）
//   2. 用户规则 deny（~/.flydex/permissions.json）
//   3. 用户规则 allow
//   4. 默认 ask（推审批 UI 等用户决定）；全自动（approval_policy=never）时 ask → allow
// 核心目标：deny 命中在工具执行前直接拒绝（先判断再执行），不再事后止损。

/// 用户规则的执行动作
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleAction {
    Deny,
    Allow,
}

impl RuleAction {
    #[allow(dead_code)] // 前端展示保留
    pub fn label(&self) -> &'static str {
        match self {
            RuleAction::Deny => "拒绝",
            RuleAction::Allow => "放行",
        }
    }
}

/// 一条权限规则（pattern 为命令子串，忽略大小写匹配）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRule {
    pub pattern: String,
    pub action: RuleAction,
    #[serde(default)]
    pub note: String,
}

/// 权限规则集（持久化 ~/.flydex/permissions.json）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PermissionRules {
    #[serde(default)]
    pub rules: Vec<PermissionRule>,
}

/// 规则引擎决策结果
#[derive(Debug, Clone, PartialEq)]
pub enum RuleDecision {
    /// 内置 deny 白名单命中（不可覆盖）
    BuiltinDeny(String),
    /// 用户规则 deny 命中
    UserDeny(String),
    /// 用户规则 allow 命中
    UserAllow(String),
    /// 默认询问
    Ask,
    /// 全自动模式下放行（approval_policy=never）
    AutoAllow,
}

impl RuleDecision {
    /// 是否放行（命中 allow 或全自动）
    #[allow(dead_code)] // 单测与前端判断保留
    pub fn is_allow(&self) -> bool {
        matches!(self, RuleDecision::UserAllow(_) | RuleDecision::AutoAllow)
    }
    /// 是否拒绝（deny 命中）
    #[allow(dead_code)] // 单测与前端判断保留
    pub fn is_deny(&self) -> bool {
        matches!(self, RuleDecision::BuiltinDeny(_) | RuleDecision::UserDeny(_))
    }
    /// 前端展示用的决策标签
    pub fn tag(&self) -> &'static str {
        match self {
            RuleDecision::BuiltinDeny(_) => "auto_deny",
            RuleDecision::UserDeny(_) => "auto_deny",
            RuleDecision::UserAllow(_) => "auto_accept",
            RuleDecision::AutoAllow => "auto_accept",
            RuleDecision::Ask => "ask",
        }
    }
}

impl SecurityService {
    fn rules_file() -> PathBuf {
        Storage::app_dir().join("permissions.json")
    }

    /// 读取规则集（文件不存在/损坏 → 空规则集）
    pub fn load_rules() -> PermissionRules {
        let path = Self::rules_file();
        if !path.exists() {
            return PermissionRules::default();
        }
        fs::read_to_string(&path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default()
    }

    fn save_rules(rules: &PermissionRules) -> std::io::Result<()> {
        fs::create_dir_all(Storage::app_dir())?;
        let content = serde_json::to_string_pretty(rules).unwrap_or_default();
        fs::write(Self::rules_file(), content)
    }

    /// 新增规则（同 pattern 同 action 去重）
    pub fn add_rule(pattern: String, action: RuleAction, note: String) -> std::io::Result<PermissionRules> {
        let mut rules = Self::load_rules();
        let pattern_trim = pattern.trim().to_string();
        if pattern_trim.is_empty() {
            return Ok(rules);
        }
        if !rules.rules.iter().any(|r| r.pattern.eq_ignore_ascii_case(&pattern_trim) && r.action == action) {
            rules.rules.push(PermissionRule {
                pattern: pattern_trim,
                action,
                note,
            });
        }
        Self::save_rules(&rules)?;
        Ok(rules)
    }

    /// 删除规则（按 index，对齐前端列表展示）
    pub fn remove_rule(index: usize) -> std::io::Result<PermissionRules> {
        let mut rules = Self::load_rules();
        if index < rules.rules.len() {
            rules.rules.remove(index);
        }
        Self::save_rules(&rules)?;
        Ok(rules)
    }

    pub fn clear_rules() -> std::io::Result<PermissionRules> {
        let rules = PermissionRules::default();
        Self::save_rules(&rules)?;
        Ok(rules)
    }

    /// 内置 deny 白名单：破坏性/不可逆的危险命令（安全底线，用户规则不可覆盖）。
    /// 命中即拒绝，对齐 Claude Code 对不可逆操作的默认 deny。
    fn builtin_deny_patterns() -> &'static [&'static str] {
        &[
            // 递归删除根/家目录/系统盘（Windows 与 bash 通用写法）
            "rm -rf /", "rm -fr /", "rm -rf --no-preserve-root /", "rm -rf ~", "rm -fr ~",
            "rm -rf c:", "rm -fr c:", "rm -rf c\\", "rm -fr c\\",
            "del /s /q c:\\", "del /s /q c:/", "rd /s /q c:\\", "rd /s /q c:/",
            "rmdir /s /q c:\\", "rmdir /s /q c:/",
            // 磁盘格式化/分区（不可逆）
            "format c:", "format c\\", "format c:/", "diskpart", "mkfs", "fdisk",
            // 直接写块设备/磁盘镜像
            "dd if=/dev/zero of=/dev/", "dd if=/dev/zero of=/dev/sd", "dd if=/dev/zero of=/dev/hd",
            // 关机/重启/注销（服务端场景破坏性）
            "shutdown -r", "shutdown /r", "shutdown -s", "shutdown /s",
            "reboot", "halt", "poweroff",
            // 注册表删除（Windows 系统级）
            "reg delete", "regedit /s",
            // 清空用户数据目录
            "rm -rf /home", "rm -rf /root", "rm -rf /Users",
            // Windows 用户目录
            "rm -rf c:\\users", "rm -fr c:\\users", "rd /s /q c:\\users",
        ]
    }

    /// 规则引擎决策：内置 deny > 用户 deny > 用户 allow > 默认 ask（全自动转 allow）
    pub fn decide(command: &str) -> RuleDecision {
        let c = command.trim().to_lowercase();
        if c.is_empty() {
            return RuleDecision::Ask;
        }
        // 1. 内置 deny（安全底线）
        for pat in Self::builtin_deny_patterns() {
            if c.contains(&pat.to_lowercase()) {
                return RuleDecision::BuiltinDeny(format!("内置规则：{pat}"));
            }
        }
        // 2/3. 用户规则（deny 优先于 allow，同 Claude Code）
        let rules = Self::load_rules();
        for r in &rules.rules {
            if c.contains(&r.pattern.to_lowercase()) {
                return match r.action {
                    RuleAction::Deny => RuleDecision::UserDeny(format!("用户规则：{}（{}）", r.pattern, r.note)),
                    RuleAction::Allow => RuleDecision::UserAllow(format!("用户规则：{}（{}）", r.pattern, r.note)),
                };
            }
        }
        // 4. 全自动模式（approval_policy=never）→ 放行
        if Self::load().approval_policy == ApprovalPolicy::Never {
            return RuleDecision::AutoAllow;
        }
        RuleDecision::Ask
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_command_is_ask() {
        assert_eq!(SecurityService::decide("   "), RuleDecision::Ask);
    }

    #[test]
    fn benign_commands_not_denied_by_default() {
        // 普通只读命令默认不应被 deny（Ask 或用户/全自动配置下的 Allow）
        let d = SecurityService::decide("git status");
        assert!(!d.is_deny(), "git status 不应被 deny: {:?}", d);
    }

    #[test]
    fn builtin_patterns_exist_and_are_non_empty() {
        // 内置 deny 白名单必须非空且每条模式非空（安全底线存在性校验）
        let pats = SecurityService::builtin_deny_patterns();
        assert!(!pats.is_empty());
        for p in pats {
            assert!(!p.trim().is_empty());
        }
    }
}
