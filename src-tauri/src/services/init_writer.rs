//! 项目初始化文档写入器(安全路径限制)
//!
//! 用于 `/init` 流程向项目根目录写 requirements.md / tech-spec.md / AGENTS.md 等。
//! 安全策略:
//! - 只允许写入相对路径(不允绝对路径)
//! - 路径必须在 workdir 子树下(防止 ../ 越界)
//! - 已有文件需要 explicit overwrite 标志才能覆盖

use std::path::{Component, Path, PathBuf};

pub struct InitWriter;

/// 写入结果
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WriteResult {
    pub path: String,
    pub bytes_written: usize,
    pub created: bool, // true=新建,false=覆盖
}

/// 把任意 path 解析为相对路径(去掉绝对前缀、`.`、`..`),返回 safe relative path
///
/// 例如:
/// - `requirements.md` → `requirements.md`
/// - `docs/requirements.md` → `docs/requirements.md`
/// - `/abs/foo` → `foo`(拒绝,返回 None)
/// - `../../etc/passwd` → `etc/passwd`(拒绝越界,返回 None)
fn safe_relative(rel: &str) -> Option<String> {
    let p = Path::new(rel);
    let mut components = Vec::new();
    for c in p.components() {
        match c {
            Component::Normal(s) => {
                if let Some(s_str) = s.to_str() {
                    if s_str.is_empty() {
                        continue;
                    }
                    components.push(s_str.to_string());
                } else {
                    return None;
                }
            }
            Component::CurDir => continue,       // `.` 忽略
            Component::ParentDir => return None, // `..` 拒绝(越界)
            _ => return None,                    // RootDir / Prefix 不允许
        }
    }
    if components.is_empty() {
        return None;
    }
    Some(components.join("/"))
}

impl InitWriter {
    /// 写入文件到 workdir 的子路径
    ///
    /// - `path` 必须为相对路径(如 `requirements.md` / `docs/tech-spec.md`)
    /// - `workdir` 为项目根
    /// - `overwrite` 为 true 时允许覆盖已有文件
    /// - 返回 WriteResult 包含实际写入路径 / 字节数 / 是否新建
    pub fn write_file(
        workdir: &str,
        path: &str,
        content: &str,
        overwrite: bool,
    ) -> Result<WriteResult, String> {
        let rel = safe_relative(path)
            .ok_or_else(|| format!("不安全路径(必须为相对路径,不允许 .. 或绝对路径): {}", path))?;
        let root = PathBuf::from(workdir);
        if !root.is_dir() {
            return Err(format!("工作目录不存在: {}", workdir));
        }
        let full = root.join(&rel);

        // 检查是否已存在
        let existed = full.exists();
        if existed && !overwrite {
            return Err(format!("文件已存在(需 overwrite=true 才覆盖): {}", rel));
        }

        // 越界兜底:`rel` 已由 safe_relative 拒绝 `..` 与绝对路径,
        // 故这里断言拼接结果仍在 root 之下(防止 workdir 本身含 `..`)
        if !full.starts_with(&root) {
            return Err(format!("路径越界: {} 不在 {} 内", rel, workdir));
        }

        // 确保父目录存在
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
        }

        std::fs::write(&full, content).map_err(|e| format!("写入失败: {}", e))?;

        Ok(WriteResult {
            path: rel,
            bytes_written: content.len(),
            created: !existed,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("flydex_writer_test_{}_{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn write_new_file() {
        let dir = temp_dir("new");
        let r = InitWriter::write_file(dir.to_str().unwrap(), "requirements.md", "# Req", false)
            .unwrap();
        assert_eq!(r.path, "requirements.md");
        assert!(r.created);
        assert_eq!(r.bytes_written, 5);
        assert!(dir.join("requirements.md").exists());
    }

    #[test]
    fn overwrite_required_for_existing() {
        let dir = temp_dir("exist");
        fs::write(dir.join("AGENTS.md"), "old").unwrap();
        // 不 overwrite 应失败
        assert!(InitWriter::write_file(dir.to_str().unwrap(), "AGENTS.md", "new", false,).is_err());
        // overwrite=true 应成功
        let r = InitWriter::write_file(dir.to_str().unwrap(), "AGENTS.md", "new", true).unwrap();
        assert!(!r.created);
    }

    #[test]
    fn reject_parent_dir_traversal() {
        let dir = temp_dir("traverse");
        // 不允许 ../ 越界
        assert!(
            InitWriter::write_file(dir.to_str().unwrap(), "../../../etc/passwd", "evil", true,)
                .is_err()
        );
    }

    #[test]
    fn reject_absolute_path() {
        let dir = temp_dir("abs");
        assert!(
            InitWriter::write_file(dir.to_str().unwrap(), "/etc/passwd", "evil", true,).is_err()
        );
    }

    #[test]
    fn support_nested_path() {
        let dir = temp_dir("nested");
        let r = InitWriter::write_file(dir.to_str().unwrap(), "docs/tech-spec.md", "# Tech", false)
            .unwrap();
        assert_eq!(r.path, "docs/tech-spec.md");
        assert!(dir.join("docs").join("tech-spec.md").exists());
    }

    #[test]
    fn safe_relative_strips_current_dir() {
        assert_eq!(safe_relative("./foo.md"), Some("foo.md".to_string()));
        assert_eq!(safe_relative("a/./b.md"), Some("a/b.md".to_string()));
    }
}
