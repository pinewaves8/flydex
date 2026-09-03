use crate::services::mcp::{
    list_servers, remove_server, save_server, test_server, McpServer,
};

/// 列出已配置的 MCP server
#[tauri::command]
pub fn mcp_list() -> Result<Vec<McpServer>, String> {
    list_servers()
}

/// 新增或覆盖一个 MCP server，返回最新列表
#[tauri::command]
pub fn mcp_save(server: McpServer) -> Result<Vec<McpServer>, String> {
    save_server(&server)?;
    list_servers()
}

/// 删除一个 MCP server，返回最新列表
#[tauri::command]
pub fn mcp_remove(name: String) -> Result<Vec<McpServer>, String> {
    remove_server(&name)?;
    list_servers()
}

/// 测试 MCP server 能否启动
#[tauri::command]
pub fn mcp_test(server: McpServer) -> Result<String, String> {
    test_server(&server)
}

/// 内置 web 工具 MCP server 信息（node + web-search-server.mjs 绝对路径）
///
/// 供 MCP 模板市场一键接入 web_search / web_fetch 工具。路径定位顺序：
/// 1. 当前可执行文件同目录 mcp/web-search-server.mjs（发布布局）
/// 2. 当前可执行文件上级目录 mcp/web-search-server.mjs（target/debug 布局）
/// 3. 开发固定路径 C:\llm\flydex\mcp\web-search-server.mjs
#[tauri::command]
#[allow(dead_code)] // 内置 web 工具 MCP 一键接入（未接线 UI，保留待用）
pub fn mcp_builtin_web_server() -> Result<crate::services::mcp::McpServer, String> {
    use std::path::PathBuf;
    let file_name = "web-search-server.mjs";
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("mcp").join(file_name));
            candidates.push(dir.join("..").join("mcp").join(file_name));
        }
    }
    // 开发固定路径兜底
    candidates.push(PathBuf::from(r"C:\llm\flydex\mcp").join(file_name));
    let found = candidates
        .iter()
        .find(|p| p.exists())
        .ok_or_else(|| "未找到内置 web 工具 MCP server（web-search-server.mjs）".to_string())?;
    Ok(crate::services::mcp::McpServer {
        name: "web-search".to_string(),
        transport: "stdio".to_string(),
        command: Some("node".to_string()),
        args: vec![found.to_string_lossy().to_string()],
        env: std::collections::HashMap::new(),
        url: None,
        approval_mode: None,
    })
}
