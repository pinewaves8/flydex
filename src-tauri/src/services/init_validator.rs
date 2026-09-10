//! AGENTS.md YAML frontmatter 质量校验
//!
//! 不引入 serde_yaml 依赖(纯字符串解析)。
//! 校验内容:必填字段是否存在(不校验值是否合理)。
//!
//! 期望的 AGENTS.md 结构:
//! ```markdown
//! ---
//! project:
//!   name: ...
//!   description: ...
//! stack:
//!   languages: [...]
//!   frameworks: [...]
//! build:
//!   command: ...
//!   test: ...
//! conventions:
//!   naming: ...
//!   comments: ...
//! workflow:
//!   commit: ...
//! ---
//!
//! # 项目补充说明
//! [Markdown body]
//! ```

use serde::{Deserialize, Serialize};

/// 校验报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationReport {
    pub path: String,
    pub has_frontmatter: bool,
    pub has_body: bool,
    /// 必填字段缺失列表
    pub missing_fields: Vec<String>,
    /// 警告(有字段但值看起来空)
    pub warnings: Vec<String>,
    /// 建议(可选字段缺失)
    pub suggestions: Vec<String>,
}

const REQUIRED_FIELDS: &[&str] = &[
    "project.name",
    "project.description",
    "stack.languages",
    "build.command",
    "build.test",
    "conventions.naming",
    "workflow.commit",
];

const OPTIONAL_FIELDS: &[&str] = &[
    "stack.frameworks",
    "stack.runtime",
    "conventions.comments",
    "conventions.files",
    "workflow.branches",
    "workflow.reviews",
];

/// 校验单个 AGENTS.md 文件
///
/// 注意:这不解析 YAML 语法,只做"行级 grep"检查。
/// 优点:零依赖、极快;缺点:不检测 YAML 缩进错误。
pub fn validate_agents_md(path: &str) -> Result<ValidationReport, String> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("读取失败: {}", e))?;

    let mut report = ValidationReport {
        path: path.to_string(),
        has_frontmatter: false,
        has_body: false,
        missing_fields: Vec::new(),
        warnings: Vec::new(),
        suggestions: Vec::new(),
    };

    // 提取 frontmatter(`---\n...\n---`)
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        // 没有 frontmatter:整个文件视为 body,所有必填字段都算缺失
        report.has_body = !trimmed.is_empty();
        for f in REQUIRED_FIELDS {
            report.missing_fields.push(f.to_string());
        }
        for f in OPTIONAL_FIELDS {
            report.suggestions.push(f.to_string());
        }
        return Ok(report);
    }

    report.has_frontmatter = true;
    // 找第一个 `---` 后的下一个 `---` 行
    let after_first = trimmed.strip_prefix("---").unwrap_or(trimmed);
    let after_first = after_first.trim_start_matches('\n');
    if let Some(end_idx) = after_first.find("\n---") {
        let fm = &after_first[..end_idx];
        let body = &after_first[end_idx + 4..]; // skip `\n---`
        report.has_body = !body.trim().is_empty();

        // 行级检查:每个必填字段必须有 `field:` 或 `field.name:` 这样的行
        for f in REQUIRED_FIELDS {
            match field_value(fm, f) {
                None => report.missing_fields.push(f.to_string()),
                Some(v) if value_is_empty(v) => {
                    report.warnings.push(format!("{} 值似乎为空", f))
                }
                Some(_) => {}
            }
        }
        for f in OPTIONAL_FIELDS {
            if field_value(fm, f).is_none() {
                report.suggestions.push(f.to_string());
            }
        }
    } else {
        // frontmatter 未闭合
        report
            .warnings
            .push("YAML frontmatter 未闭合(缺少结束 ---)".to_string());
    }

    Ok(report)
}

/// 取 frontmatter 中某字段的值(`None` = 字段不存在)
///
/// 支持嵌套路径如 `project.name`(按点数推导缩进层级:每层 2 空格)。
fn field_value<'a>(fm: &'a str, field: &str) -> Option<&'a str> {
    let parts: Vec<&str> = field.split('.').collect();
    let last = parts.last()?;
    let want_indent = (parts.len() - 1) * 2;

    for line in fm.lines() {
        let trimmed = line.trim_start();
        // 跳过注释与列表项
        if trimmed.starts_with('#') || trimmed.starts_with('-') {
            continue;
        }
        if line.len() - trimmed.len() != want_indent {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix(last) {
            if let Some(after_colon) = rest.strip_prefix(':') {
                return Some(after_colon.trim());
            }
        }
    }
    None
}

/// 值是否为空(`name:` / `name: # 占位` 都算空)
fn value_is_empty(v: &str) -> bool {
    v.is_empty() || v == "#" || v == "# ..."
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_file(tag: &str, content: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "flydex_validator_test_{}_{}",
            tag,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("AGENTS.md");
        fs::write(&p, content).unwrap();
        p
    }

    #[test]
    fn complete_agents_md_no_missing() {
        let content = r#"---
project:
  name: MyApp
  description: A test project
stack:
  languages: [Rust, TS]
  frameworks: [Tauri]
build:
  command: cargo build
  test: cargo test
conventions:
  naming: snake_case
  comments: 中文
workflow:
  commit: flydex-checkpoint
---

# 项目补充说明
这是项目补充内容
"#;
        let p = temp_file("complete", content);
        let r = validate_agents_md(p.to_str().unwrap()).unwrap();
        assert!(r.has_frontmatter);
        assert!(r.has_body);
        assert!(r.missing_fields.is_empty(), "缺失: {:?}", r.missing_fields);
    }

    #[test]
    fn missing_required_fields() {
        let content = "---\nproject:\n  name: Test\n---\n# body\n";
        let p = temp_file("missing", content);
        let r = validate_agents_md(p.to_str().unwrap()).unwrap();
        assert!(r.has_frontmatter);
        assert!(r.missing_fields.len() > 0);
        assert!(r.missing_fields.iter().any(|f| f.contains("description")));
        assert!(r.missing_fields.iter().any(|f| f.contains("build")));
    }

    #[test]
    fn no_frontmatter_all_missing() {
        let content = "# Just a markdown doc\nNo frontmatter at all\n";
        let p = temp_file("nofm", content);
        let r = validate_agents_md(p.to_str().unwrap()).unwrap();
        assert!(!r.has_frontmatter);
        assert_eq!(r.missing_fields.len(), REQUIRED_FIELDS.len());
    }

    #[test]
    fn empty_values_are_warnings() {
        let content = "---\nproject:\n  name: Test\n  description: \nstack:\n  languages: [Go]\nbuild:\n  command: make\n  test: make test\nconventions:\n  naming: snake\nworkflow:\n  commit: feat:\n---\n# body\n";
        let p = temp_file("empty", content);
        let r = validate_agents_md(p.to_str().unwrap()).unwrap();
        assert!(r.warnings.iter().any(|w| w.contains("description")));
    }

    #[test]
    fn unclosed_frontmatter_warning() {
        let content = "---\nproject:\n  name: Test\n# 没有结束 ---";
        let p = temp_file("unclosed", content);
        let r = validate_agents_md(p.to_str().unwrap()).unwrap();
        assert!(r.warnings.iter().any(|w| w.contains("未闭合")));
    }
}
