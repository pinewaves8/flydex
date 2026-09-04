use tauri::command;

use crate::services::security::{
    ApprovalPolicy, ApprovalRecord, PermissionRules, RuleAction, RuleDecision, SandboxMode,
    SecurityConfig, SecurityService,
};

/// 读取当前安全配置
#[command]
pub fn get_security() -> SecurityConfig {
    SecurityService::load()
}

/// 设置沙箱模式（read-only / workspace-write / danger-full-access）
#[command]
pub fn set_sandbox_mode(mode: String) -> Result<SecurityConfig, String> {
    let parsed = match mode.as_str() {
        "read-only" => SandboxMode::ReadOnly,
        "workspace-write" => SandboxMode::WorkspaceWrite,
        "danger-full-access" => SandboxMode::DangerFullAccess,
        _ => return Err(format!("Unknown sandbox mode: {}", mode)),
    };
    SecurityService::set_sandbox_mode(parsed).map_err(|e| e.to_string())
}

/// 设置审批策略（untrusted / on-request / never）
#[command]
pub fn set_approval_policy(policy: String) -> Result<SecurityConfig, String> {
    let parsed = match policy.as_str() {
        "untrusted" => ApprovalPolicy::Untrusted,
        "on-request" => ApprovalPolicy::OnRequest,
        "never" => ApprovalPolicy::Never,
        _ => return Err(format!("Unknown approval policy: {}", policy)),
    };
    SecurityService::set_approval_policy(parsed).map_err(|e| e.to_string())
}

/// 设置 git 自动快照开关（turn/completed 后自动 commit 本地快照）
#[command]
pub fn set_auto_checkpoint(enabled: bool) -> Result<SecurityConfig, String> {
    SecurityService::set_auto_checkpoint(enabled).map_err(|e| e.to_string())
}

/// 记录一条审批历史
#[command]
pub fn record_approval(
    command: String,
    approved: bool,
    run_id: String,
) -> Result<SecurityConfig, String> {
    let record = ApprovalRecord {
        id: format!(
            "ap-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
        command,
        approved,
        run_id,
    };
    SecurityService::add_history(record).map_err(|e| e.to_string())
}

/// 清空审批历史
#[command]
pub fn clear_approval_history() -> Result<SecurityConfig, String> {
    SecurityService::clear_history().map_err(|e| e.to_string())
}

/// 新增权限规则（deny/allow）
#[command]
pub fn add_permission_rule(
    pattern: String,
    action: String,
    note: Option<String>,
) -> Result<PermissionRules, String> {
    let parsed = match action.as_str() {
        "deny" => RuleAction::Deny,
        "allow" => RuleAction::Allow,
        _ => return Err(format!("Unknown rule action: {}", action)),
    };
    SecurityService::add_rule(pattern, parsed, note.unwrap_or_default()).map_err(|e| e.to_string())
}

/// 删除权限规则（按 index）
#[command]
pub fn remove_permission_rule(index: usize) -> Result<PermissionRules, String> {
    SecurityService::remove_rule(index).map_err(|e| e.to_string())
}

/// 读取全部权限规则
#[command]
pub fn list_permission_rules() -> PermissionRules {
    SecurityService::load_rules()
}

/// 清空权限规则
#[command]
pub fn clear_permission_rules() -> Result<PermissionRules, String> {
    SecurityService::clear_rules().map_err(|e| e.to_string())
}

/// 规则决策测试结果（7.3 GUI 实测入口，不执行命令，仅返回规则引擎判定）
#[derive(serde::Serialize)]
pub struct RuleTestResult {
    /// auto_deny / auto_accept / ask
    pub tag: String,
    pub reason: String,
    pub denied: bool,
}

/// 输入任意命令，返回规则引擎的决策结果（deny/allow/ask），用于 GUI 实测与规则校验。
/// 只判定、不执行；模型自觉拒绝对此无影响（这是纯规则层验证入口）。
#[command]
pub fn security_test_rule(command: String) -> RuleTestResult {
    let d = SecurityService::decide(&command);
    match d {
        RuleDecision::BuiltinDeny(r) => RuleTestResult { tag: "auto_deny".into(), reason: r, denied: true },
        RuleDecision::UserDeny(r) => RuleTestResult { tag: "auto_deny".into(), reason: r, denied: true },
        RuleDecision::UserAllow(r) => RuleTestResult { tag: "auto_accept".into(), reason: r, denied: false },
        RuleDecision::AutoAllow => RuleTestResult { tag: "auto_accept".into(), reason: "全自动模式（approval_policy=never）放行".into(), denied: false },
        RuleDecision::Ask => RuleTestResult { tag: "ask".into(), reason: "需要审批（未命中 deny/allow 规则）".into(), denied: false },
    }
}
