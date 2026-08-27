use tauri::command;

use crate::services::security::{
    ApprovalPolicy, ApprovalRecord, SandboxMode, SecurityConfig, SecurityService,
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
