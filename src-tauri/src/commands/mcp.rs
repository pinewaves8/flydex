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
