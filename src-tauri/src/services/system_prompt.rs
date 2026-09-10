//! 项目规范自动加载到 system prompt(对齐 Claude Code `AGENTS.md` / `CLAUDE.md` 行为)
//!
//! 每次 codex exec 时扫描项目根目录,拼接现有规范文件注入 prompt。
//! 关键设计:
//! - 优先级:AGENTS.md > CLAUDE.md > CONVENTIONS.md > .flydex/CONVENTIONS.md
//! - 大小限制:单文件最大 30KB(防止撑爆 context window)
//! - 安全:只读相对路径,跳过不存在的文件

use std::path::Path;

const MAX_BYTES_PER_FILE: usize = 30 * 1024; // 30 KB
const MAX_TOTAL_BYTES: usize = 60 * 1024; // 总共 60 KB 上限

/// 候选文件路径(相对项目根)
const CANDIDATES: &[&str] = &[
    "AGENTS.md",
    "CLAUDE.md",
    "CONVENTIONS.md",
    ".flydex/CONVENTIONS.md",
];

pub struct ProjectContextLoader;

impl ProjectContextLoader {
    /// 构建项目规范 context block(注入到 final_command 前面)
    ///
    /// 返回格式:
    /// ```
    /// # 项目规范(自动加载)
    ///
    /// <文件 1 内容>
    /// ---
    /// <文件 2 内容>
    /// ---
    /// ```
    ///
    /// 如果没有任何候选文件,返回空字符串
    pub fn build_context(workdir: &str) -> String {
        let root = Path::new(workdir);
        if !root.is_dir() {
            return String::new();
        }

        let mut sections: Vec<String> = Vec::new();
        let mut total_bytes = 0;

        for rel in CANDIDATES {
            if total_bytes >= MAX_TOTAL_BYTES {
                break;
            }
            let full = root.join(rel);
            if !full.is_file() {
                continue;
            }
            let content = match std::fs::read_to_string(&full) {
                Ok(c) => c,
                Err(_) => continue,
            };
            // 大小限制
            let truncated = if content.len() > MAX_BYTES_PER_FILE {
                let cut_at = MAX_BYTES_PER_FILE;
                // 找到字符边界(避免截断 UTF-8)
                let mut end = cut_at;
                while end > 0 && !content.is_char_boundary(end) {
                    end -= 1;
                }
                format!(
                    "{}\n\n---\n> ⚠️ Flydex 自动截断:文件大小 {} KB,只加载前 {} KB(防止撑爆 context)。完整内容请 AI 用 Read 工具按需查看。",
                    &content[..end],
                    content.len() / 1024,
                    MAX_BYTES_PER_FILE / 1024
                )
            } else {
                content
            };

            let section_size = truncated.len();
            total_bytes += section_size;

            sections.push(format!("## 来源: `{}`\n\n{}", rel, truncated.trim_end()));
        }

        if sections.is_empty() {
            return String::new();
        }

        format!(
            "\n# 项目规范(自动加载自项目根)\n\n{}\n\n",
            sections.join("\n\n---\n\n")
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("flydex_ctx_test_{}_{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn empty_dir_returns_empty() {
        let dir = temp_dir("empty");
        let ctx = ProjectContextLoader::build_context(dir.to_str().unwrap());
        assert_eq!(ctx, "");
    }

    #[test]
    fn agents_md_is_loaded() {
        let dir = temp_dir("agents");
        fs::write(dir.join("AGENTS.md"), "# My Project Rules").unwrap();
        let ctx = ProjectContextLoader::build_context(dir.to_str().unwrap());
        assert!(ctx.contains("# 项目规范"));
        assert!(ctx.contains("# My Project Rules"));
        assert!(ctx.contains("AGENTS.md"));
    }

    #[test]
    fn priority_agents_then_claude() {
        let dir = temp_dir("priority");
        fs::write(dir.join("CLAUDE.md"), "from-claude").unwrap();
        fs::write(dir.join("AGENTS.md"), "from-agents").unwrap();
        let ctx = ProjectContextLoader::build_context(dir.to_str().unwrap());
        // AGENTS.md 应排在 CLAUDE.md 前面
        let agents_pos = ctx.find("from-agents").unwrap();
        let claude_pos = ctx.find("from-claude").unwrap();
        assert!(agents_pos < claude_pos, "AGENTS.md 应优先");
    }

    #[test]
    fn large_file_truncated() {
        let dir = temp_dir("large");
        // 写一个 40KB 的文件(超过 30KB 限制)
        let big_content = "x".repeat(40 * 1024);
        fs::write(dir.join("AGENTS.md"), &big_content).unwrap();
        let ctx = ProjectContextLoader::build_context(dir.to_str().unwrap());
        // 不应包含完整 40KB(应被截断)
        assert!(ctx.len() < big_content.len());
        assert!(ctx.contains("Flydex 自动截断"));
    }
}
