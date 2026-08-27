use std::path::Path;

/// 解析目录路径（供终端 cd 使用）
///
/// 处理相对/绝对路径、`..`、`\`/`/`（根目录）、盘符，并校验目录存在。
/// 返回规范化的绝对路径。由 Rust 后端完成，绕开前端 shell 插件的引号转义问题。
#[tauri::command]
pub fn resolve_dir(path: String, cwd: String) -> Result<String, String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("empty path".to_string());
    }

    // 组合目标路径
    let target = if p == "\\" || p == "/" {
        // 根目录：当前盘符的根
        let drive = cwd.split(':').next().unwrap_or("C");
        format!("{}:\\", drive)
    } else if Path::new(p).is_absolute() {
        p.to_string()
    } else {
        Path::new(&cwd)
            .join(p)
            .to_string_lossy()
            .to_string()
    };

    // 规范化并校验存在
    let canonical = std::fs::canonicalize(&target)
        .map_err(|_| format!("目录不存在: {}", target))?;
    if !canonical.is_dir() {
        return Err(format!("不是目录: {}", target));
    }

    let mut s = canonical.to_string_lossy().to_string();
    // Windows 上 canonicalize 会返回 \\?\ 扩展路径前缀，去掉以保持与真实终端一致
    #[cfg(windows)]
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        s = stripped.to_string();
    }

    Ok(s)
}
