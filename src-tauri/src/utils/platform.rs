/// 平台相关工具函数

/// 是否为 Windows
pub fn is_windows() -> bool {
    cfg!(windows)
}

/// 是否为 macOS
pub fn is_macos() -> bool {
    cfg!(target_os = "macos")
}

/// 是否为 Linux
pub fn is_linux() -> bool {
    cfg!(target_os = "linux")
}

/// 获取平台名称
pub fn platform_name() -> &'static str {
    if is_windows() {
        "windows"
    } else if is_macos() {
        "macos"
    } else {
        "linux"
    }
}
