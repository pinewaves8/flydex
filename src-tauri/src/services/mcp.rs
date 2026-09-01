use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// MCP Server 配置（codex config.toml 的 [mcp_servers.xxx] 段）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub name: String,
    /// "stdio" | "sse"
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub url: Option<String>,
    pub approval_mode: Option<String>,
}

fn config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法定位用户主目录")?;
    Ok(home.join(".codex").join("config.toml"))
}

/// 解析 [mcp_servers.xxx] 段内的 key = value 行
fn parse_block(name: String, lines: &[String]) -> McpServer {
    let mut s = McpServer {
        name,
        transport: "stdio".to_string(),
        command: None,
        args: Vec::new(),
        env: HashMap::new(),
        url: None,
        approval_mode: None,
    };
    for line in lines {
        let line = line.trim();
        let Some(idx) = line.find('=') else { continue };
        let key = line[..idx].trim();
        let raw = line[idx + 1..].trim();
        let Ok(val) = raw.parse::<toml::Value>() else { continue };
        match key {
            "command" => {
                if let toml::Value::String(v) = val {
                    s.command = Some(v);
                    s.transport = "stdio".to_string();
                }
            }
            "args" => {
                if let toml::Value::Array(arr) = val {
                    s.args = arr
                        .into_iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect();
                }
            }
            "env" => {
                if let toml::Value::Table(t) = val {
                    s.env = t
                        .into_iter()
                        .filter_map(|(k, v)| v.as_str().map(|x| (k, x.to_string())))
                        .collect();
                }
            }
            "url" => {
                if let toml::Value::String(v) = val {
                    s.url = Some(v);
                    s.transport = "sse".to_string();
                }
            }
            "default_tools_approval_mode" => {
                if let toml::Value::String(v) = val {
                    s.approval_mode = Some(v);
                }
            }
            _ => {}
        }
    }
    s
}

/// 渲染 [mcp_servers.xxx] 段文本（args 用单引号字面量，与现有配置一致）
fn render_block(s: &McpServer) -> String {
    let mut b = format!("[mcp_servers.{}]", s.name);
    if s.transport == "sse" {
        if let Some(u) = &s.url {
            b.push_str(&format!("\nurl = \"{}\"", u));
        }
    } else {
        if let Some(c) = &s.command {
            b.push_str(&format!("\ncommand = \"{}\"", c));
        }
        if !s.args.is_empty() {
            let arr: Vec<String> = s.args.iter().map(|a| format!("'{}'", a)).collect();
            b.push_str(&format!("\nargs = [{}]", arr.join(", ")));
        }
    }
    if !s.env.is_empty() {
        let t: Vec<String> = s
            .env
            .iter()
            .map(|(k, v)| format!("{} = \"{}\"", k, v))
            .collect();
        b.push_str(&format!("\nenv = {{ {} }}", t.join(", ")));
    }
    if let Some(m) = &s.approval_mode {
        b.push_str(&format!("\ndefault_tools_approval_mode = \"{}\"", m));
    }
    b
}

/// 读取所有已配置的 MCP server（仅保留语义，注释忽略）
pub fn list_servers() -> Result<Vec<McpServer>, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut servers = Vec::new();
    let mut cur: Option<(String, Vec<String>)> = None;
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with('[') && t.ends_with(']') {
            if let Some((name, lines)) = cur.take() {
                servers.push(parse_block(name, &lines));
            }
            if let Some(rest) = t.strip_prefix("[mcp_servers.") {
                if let Some(name) = rest.strip_suffix(']') {
                    cur = Some((name.trim().to_string(), Vec::new()));
                }
            }
        } else if let Some((_, lines)) = cur.as_mut() {
            if !t.is_empty() && !t.starts_with('#') {
                lines.push(line.to_string());
            }
        }
    }
    if let Some((name, lines)) = cur.take() {
        servers.push(parse_block(name, &lines));
    }
    Ok(servers)
}

/// 找到 [mcp_servers.xxx] 段的结束行索引（下一个 `[` 开头行或 EOF）
fn block_end(lines: &[&str], start: usize) -> usize {
    let mut j = start + 1;
    while j < lines.len() {
        let t = lines[j].trim();
        if t.starts_with('[') && t.ends_with(']') {
            break;
        }
        j += 1;
    }
    j
}

/// 新增或覆盖一个 MCP server（保留文件其余部分原文与注释）
pub fn save_server(server: &McpServer) -> Result<(), String> {
    let path = config_path()?;
    let content = fs::read_to_string(&path).unwrap_or_default();
    let block = render_block(server);
    let lines: Vec<&str> = content.split('\n').collect();
    let mut out = String::new();
    let mut replaced = false;
    let mut i = 0;
    while i < lines.len() {
        let t = lines[i].trim();
        if t.starts_with("[mcp_servers.") && t.ends_with(']') {
            let name = t
                .trim_start_matches("[mcp_servers.")
                .trim_end_matches(']')
                .trim();
            if name == server.name {
                let end = block_end(&lines, i);
                let trimmed = out.trim_end_matches('\n');
                out = trimmed.to_string();
                out.push('\n');
                out.push_str(&block);
                out.push('\n');
                replaced = true;
                i = end;
                continue;
            }
        }
        out.push_str(lines[i]);
        out.push('\n');
        i += 1;
    }
    if !replaced {
        if !out.trim().is_empty() {
            out.push('\n');
        }
        out.push_str(&block);
        out.push('\n');
    }
    fs::write(&path, out).map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除一个 MCP server
pub fn remove_server(name: &str) -> Result<(), String> {
    let path = config_path()?;
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let lines: Vec<&str> = content.split('\n').collect();
    let mut out = String::new();
    let mut i = 0;
    while i < lines.len() {
        let t = lines[i].trim();
        if t.starts_with("[mcp_servers.") && t.ends_with(']') {
            let n = t
                .trim_start_matches("[mcp_servers.")
                .trim_end_matches(']')
                .trim();
            if n == name {
                i = block_end(&lines, i);
                continue;
            }
        }
        out.push_str(lines[i]);
        out.push('\n');
        i += 1;
    }
    // 清理删除段后可能残留的连续空行
    let mut cleaned = String::new();
    let mut prev_blank = false;
    for l in out.lines() {
        let blank = l.trim().is_empty();
        if blank && prev_blank {
            continue;
        }
        cleaned.push_str(l);
        cleaned.push('\n');
        prev_blank = blank;
    }
    fs::write(&path, cleaned).map_err(|e| e.to_string())?;
    Ok(())
}

/// 测试 MCP server 能否启动
pub fn test_server(server: &McpServer) -> Result<String, String> {
    if server.transport == "sse" {
        let url = server.url.as_ref().ok_or("SSE server 缺少 url")?;
        match ureq::get(url)
            .timeout(std::time::Duration::from_secs(5))
            .call()
        {
            Ok(_) => Ok(format!("SSE 端点可达: {}", url)),
            Err(e) => Err(format!("SSE 连接失败: {}", e)),
        }
    } else {
        let cmd = server.command.as_ref().ok_or("stdio server 缺少 command")?;
        let is_batch = cmd.to_lowercase().ends_with(".cmd") || cmd.to_lowercase().ends_with(".bat");
        let mut c = if is_batch {
            let mut cc = std::process::Command::new("cmd");
            cc.arg("/c");
            cc.arg(cmd);
            cc
        } else {
            std::process::Command::new(cmd)
        };
        for a in &server.args {
            c.arg(a);
        }
        for (k, v) in &server.env {
            c.env(k, v);
        }
        c.stdout(std::process::Stdio::null());
        c.stderr(std::process::Stdio::piped());
        let mut child = c.spawn().map_err(|e| format!("无法启动 {}: {}", cmd, e))?;
        std::thread::sleep(std::time::Duration::from_millis(1200));
        match child.try_wait() {
            Ok(Some(status)) => {
                let _ = child.wait();
                if status.success() {
                    Ok(format!(
                        "进程已退出 (exit {})：stdio server 应常驻运行，请确认命令是否进入前台监听",
                        status.code().unwrap_or(-1)
                    ))
                } else {
                    let mut err = String::new();
                    use std::io::Read;
                    if let Some(mut r) = child.stderr.take() {
                        let _ = r.read_to_string(&mut err);
                    }
                    Err(format!(
                        "启动失败 (exit {}): {}",
                        status.code().unwrap_or(-1),
                        err.trim()
                    ))
                }
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                Ok(format!("启动成功：{} 保持运行，可作为 MCP server", cmd))
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                Ok(format!("启动成功：{} 保持运行，可作为 MCP server", cmd))
            }
        }
    }
}
