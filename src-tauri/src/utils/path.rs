use std::path::{Path, PathBuf};

/// 路径相关工具函数

/// 规范化路径（统一分隔符）
pub fn normalize_path(path: &str) -> PathBuf {
    PathBuf::from(path)
}

/// 检查路径是否存在
pub fn path_exists(path: &Path) -> bool {
    path.exists()
}

/// 获取用户主目录
pub fn home_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(PathBuf::from)
}

/// 获取应用数据目录
pub fn app_data_dir() -> Option<PathBuf> {
    home_dir().map(|home| {
        if cfg!(windows) {
            home.join("AppData").join("Roaming").join("Flydex")
        } else if cfg!(target_os = "macos") {
            home.join("Library").join("Application Support").join("Flydex")
        } else {
            home.join(".config").join("flydex")
        }
    })
}
