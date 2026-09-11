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

/// 解析单个 TOML 值（toml::Value::from_str 解析整个文档，不能直接解析裸值，
/// 因此包装成 `__v = <raw>` 行再解析）
fn parse_single_value(raw: &str) -> Option<toml::Value> {
    format!("__v = {}", raw)
        .parse::<toml::Value>()
        .ok()
        .and_then(|mut v| {
            if let toml::Value::Table(t) = &mut v {
                t.remove("__v")
            } else {
                None
            }
        })
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
        let Some(val) = parse_single_value(raw) else { continue };
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
    Ok(parse_servers(&content))
}

/// 从 `config.toml` 的文本里解析出 `[mcp_servers.*]` 段
///
/// 抽成纯函数是为了能**真正地测**:原先解析内联在读文件那一支里,结果唯一的
/// 「测试」变成读开发者本机的真实配置、再断言里面有个叫 web-search 的服务器 ——
/// 换台机器或上 CI 必挂,而且它测的不是这段代码。
///
/// 注意嵌套段(`[mcp_servers.foo.env]`):只有**恰好一层**的段名才算一个 server,
/// 更深的属于上一个 server 的配置。否则会凭空多出一个叫 `foo.env` 的服务器。
fn parse_servers(content: &str) -> Vec<McpServer> {
    let mut servers = Vec::new();
    let mut cur: Option<(String, Vec<String>)> = None;
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with('[') && t.ends_with(']') {
            if let Some(rest) = t.strip_prefix("[mcp_servers.") {
                let name = rest.strip_suffix(']').unwrap_or(rest).trim();
                if name.contains('.') {
                    // 嵌套段:不新开 server,也不结束当前这个(它的行归上一个块)
                    continue;
                }
                if let Some((n, lines)) = cur.take() {
                    servers.push(parse_block(n, &lines));
                }
                cur = Some((name.to_string(), Vec::new()));
            } else if let Some((n, lines)) = cur.take() {
                // 其它顶层段:当前 server 到此为止
                servers.push(parse_block(n, &lines));
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
    servers
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_command_line() {
        let s = parse_block(
            "web-search".into(),
            &[
                "command = \"node\"".to_string(),
                "default_tools_approval_mode = \"never\"".to_string(),
            ],
        );
        assert_eq!(s.command.as_deref(), Some("node"));
        assert_eq!(s.approval_mode.as_deref(), Some("never"));
    }

    /// 原 `list_real_config` 读的是开发者本机的 `~/.codex/config.toml`,再断言里面
    /// 有个叫 web-search 的服务器 —— 换个环境(或 CI)必挂,而且它测的不是这段代码。
    /// 改成对纯函数喂固定文本:同样覆盖解析逻辑,却与机器状态无关。
    #[test]
    fn parses_multiple_servers() {
        let servers = parse_servers(
            r#"
# 顶层注释
[mcp_servers.web-search]
command = "node"
args = ["server.js", "--port", "3000"]
default_tools_approval_mode = "never"

[mcp_servers.remote]
url = "https://example.com/mcp"
"#,
        );
        assert_eq!(servers.len(), 2);
        let ws = servers.iter().find(|s| s.name == "web-search").unwrap();
        assert_eq!(ws.command.as_deref(), Some("node"));
        assert_eq!(ws.transport, "stdio");
        assert_eq!(ws.args, vec!["server.js", "--port", "3000"]);
        assert_eq!(ws.approval_mode.as_deref(), Some("never"));

        let remote = servers.iter().find(|s| s.name == "remote").unwrap();
        assert_eq!(remote.url.as_deref(), Some("https://example.com/mcp"));
        assert!(!remote.transport.is_empty(), "transport 不该为空");
    }

    #[test]
    fn ignores_comments_blank_lines_and_unrelated_sections() {
        let servers = parse_servers(
            r#"
[other_section]
foo = "bar"

[mcp_servers.a]
command = "x"
# 注释

[mcp_servers.b]
command = "y"
"#,
        );
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].name, "a");
        assert_eq!(servers[1].name, "b");
    }

    #[test]
    fn nested_section_does_not_create_a_phantom_server() {
        // `[mcp_servers.foo.env]` 是 foo 的嵌套配置,不是另一个叫 "foo.env" 的服务器
        let servers = parse_servers(
            r#"
[mcp_servers.foo]
command = "x"

[mcp_servers.foo.env]
TOKEN = "abc"
"#,
        );
        assert_eq!(servers.len(), 1, "不该多出幽灵服务器: {servers:?}");
        assert_eq!(servers[0].name, "foo");
    }

    #[test]
    fn empty_or_missing_section_yields_nothing() {
        assert!(parse_servers("").is_empty());
        assert!(parse_servers("# 只有注释\n").is_empty());
        assert!(parse_servers("[other]\nk = 1\n").is_empty());
    }

    #[test]
    fn block_without_recognized_keys_still_listed() {
        // 段存在但内容我们都不认识:仍应作为一个 server 出现,而不是被丢掉
        let servers = parse_servers("[mcp_servers.odd]\nunknown = 1\n");
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "odd");
        assert!(servers[0].command.is_none());
    }
}
