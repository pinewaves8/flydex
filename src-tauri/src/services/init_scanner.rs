//! 项目初始化扫描器(对齐 Claude Code `/init` 行为)
//!
//! 扫描项目根目录,识别:
//! - 现有规范文件(AGENTS.md / CLAUDE.md / CONVENTIONS.md)
//! - 需求文档(requirements.md / REQUIREMENTS.md / docs/requirements.md)
//! - 技术文档(tech-spec.md / architecture.md 等)
//! - 项目骨架(.git / README.md / package.json / Cargo.toml 等)
//!
//! 返回 InitReport 供前端决定 init 流程(情况 A/B/C/D)。

use serde::{Deserialize, Serialize};
use std::path::Path;

/// 单个候选文件的扫描结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandidateFile {
    pub path: String,
    pub size_bytes: u64,
    /// 前 50 行摘要(帮助 AI / 用户快速了解内容)
    pub first_lines: Vec<String>,
}

/// 项目初始化扫描报告
///
/// scenario 字段:
/// - "A" 已有规范文件(AGENTS.md / CLAUDE.md)
/// - "B" 有需求或技术文档,但无规范
/// - "C" 项目已有骨架(.git / README / build 文件),但无任何文档
/// - "D" 全新项目(无任何文件)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitReport {
    pub workdir: String,
    pub has_git: bool,
    pub has_readme: bool,
    /// 候选文件列表(供前端展示)
    pub candidates: Vec<CandidateFile>,
    /// 检测到的规范文件(优先级顺序)
    pub spec_files: Vec<String>,
    /// 需求文档候选
    pub requirements_files: Vec<String>,
    /// 技术文档候选
    pub tech_spec_files: Vec<String>,
    /// 构建/包管理文件(package.json / Cargo.toml / pyproject.toml 等)
    pub build_files: Vec<String>,
    /// 初始场景判断("A" / "B" / "C" / "D")
    pub scenario: String,
    pub scenario_label: String,
    /// 推荐的下一步(供前端 UI 提示)
    pub recommendation: String,
}

pub struct InitScanner;

impl InitScanner {
    /// 扫描指定工作目录,返回 InitReport
    pub fn scan(workdir: &str) -> Result<InitReport, String> {
        let root = Path::new(workdir);
        if !root.exists() {
            return Err(format!("目录不存在: {}", workdir));
        }
        if !root.is_dir() {
            return Err(format!("不是目录: {}", workdir));
        }

        let mut report = InitReport {
            workdir: workdir.to_string(),
            has_git: root.join(".git").exists(),
            has_readme: root.join("README.md").exists() || root.join("readme.md").exists(),
            candidates: Vec::new(),
            spec_files: Vec::new(),
            requirements_files: Vec::new(),
            tech_spec_files: Vec::new(),
            build_files: Vec::new(),
            scenario: "D".to_string(),
            scenario_label: "全新项目".to_string(),
            recommendation: "从零开始引导对话生成需求/技术文档".to_string(),
        };

        // 候选文件分类(每个数组内部按优先级排序)
        let spec_names = [
            "AGENTS.md",
            "CLAUDE.md",
            "CONVENTIONS.md",
            ".flydex/CONVENTIONS.md",
        ];
        let req_names = [
            "requirements.md",
            "REQUIREMENTS.md",
            "docs/requirements.md",
            "docs/REQUIREMENTS.md",
            "spec/requirements.md",
        ];
        let tech_names = [
            "tech-spec.md",
            "TECHNICAL.md",
            "docs/tech-spec.md",
            "docs/architecture.md",
            "ARCHITECTURE.md",
            "docs/design.md",
            "DESIGN.md",
        ];
        let build_names = [
            "package.json",
            "Cargo.toml",
            "pyproject.toml",
            "pom.xml",
            "build.gradle",
            "build.gradle.kts",
            "go.mod",
            "setup.py",
        ];

        // 按分类扫描:每个候选名数组对应 report 中一个字段,避免用字符串 tag 再分发一次
        let name_groups: [(&[&str], fn(&mut InitReport) -> &mut Vec<String>); 4] = [
            (&spec_names, |r| &mut r.spec_files),
            (&req_names, |r| &mut r.requirements_files),
            (&tech_names, |r| &mut r.tech_spec_files),
            (&build_names, |r| &mut r.build_files),
        ];

        // 用 canonicalize 把候选文件转成绝对路径(Windows 文件系统大小写不敏感,
        // 避免 requirements.md 和 REQUIREMENTS.md 被识别为两个文件)
        let mut seen_paths: std::collections::HashSet<std::path::PathBuf> =
            std::collections::HashSet::new();
        for (names, bucket) in &name_groups {
            for rel in *names {
                let full = root.join(rel);
                if !full.is_file() {
                    continue;
                }
                // canonicalize 返回 OS 真实路径(小写 + 正斜杠),用作去重 key
                let canon = full.canonicalize().unwrap_or_else(|_| full.clone());
                if !seen_paths.insert(canon.clone()) {
                    continue;
                }
                let meta = match std::fs::metadata(&canon) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let content = std::fs::read_to_string(&canon).unwrap_or_default();
                let first_lines: Vec<String> =
                    content.lines().take(50).map(|s| s.to_string()).collect();

                let candidate = CandidateFile {
                    path: rel.to_string(),
                    size_bytes: meta.len(),
                    first_lines,
                };

                bucket(&mut report).push(rel.to_string());
                report.candidates.push(candidate);
            }
        }

        // 场景判断(优先级: A > B > C > D)
        if !report.spec_files.is_empty() {
            report.scenario = "A".to_string();
            report.scenario_label = "已有规范文件".to_string();
            report.recommendation = format!(
                "检测到 {} 个规范文件,推荐先查看内容再决定如何整合(默认不覆盖)",
                report.spec_files.len()
            );
        } else if !report.requirements_files.is_empty() || !report.tech_spec_files.is_empty() {
            report.scenario = "B".to_string();
            report.scenario_label = "有文档但无规范".to_string();
            report.recommendation = "基于现有需求/技术文档生成 AGENTS.md(无需引导对话)".to_string();
        } else if report.has_git || report.has_readme || !report.build_files.is_empty() {
            report.scenario = "C".to_string();
            report.scenario_label = "项目已有骨架".to_string();
            report.recommendation = "项目骨架已存在,推荐先补全需求/技术文档再生成规范".to_string();
        } else {
            report.scenario = "D".to_string();
            report.scenario_label = "全新项目".to_string();
            report.recommendation = "进入引导对话,逐项生成需求→技术→规范文档".to_string();
        }

        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("flydex_init_test_{}_{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scan_empty_dir_returns_scenario_d() {
        let dir = temp_dir("empty");
        let r = InitScanner::scan(dir.to_str().unwrap()).unwrap();
        assert_eq!(r.scenario, "D");
        assert!(!r.has_git);
        assert!(!r.has_readme);
        assert!(r.candidates.is_empty());
    }

    #[test]
    fn scan_with_spec_file_returns_scenario_a() {
        let dir = temp_dir("spec");
        fs::write(dir.join("AGENTS.md"), "# Test").unwrap();
        let r = InitScanner::scan(dir.to_str().unwrap()).unwrap();
        assert_eq!(r.scenario, "A");
        assert_eq!(r.spec_files, vec!["AGENTS.md".to_string()]);
    }

    #[test]
    fn scan_with_requirements_no_spec_returns_scenario_b() {
        let dir = temp_dir("req");
        fs::write(dir.join("requirements.md"), "# Req").unwrap();
        let r = InitScanner::scan(dir.to_str().unwrap()).unwrap();
        assert_eq!(r.scenario, "B");
        assert_eq!(r.requirements_files, vec!["requirements.md".to_string()]);
        assert!(r.spec_files.is_empty());
    }

    #[test]
    fn scan_with_git_no_docs_returns_scenario_c() {
        let dir = temp_dir("git");
        fs::create_dir(dir.join(".git")).unwrap();
        let r = InitScanner::scan(dir.to_str().unwrap()).unwrap();
        assert_eq!(r.scenario, "C");
        assert!(r.has_git);
    }

    #[test]
    fn scan_first_lines_capped_at_50() {
        let dir = temp_dir("lines");
        let mut content = String::new();
        for i in 0..100 {
            content.push_str(&format!("line {}\n", i));
        }
        fs::write(dir.join("AGENTS.md"), &content).unwrap();
        let r = InitScanner::scan(dir.to_str().unwrap()).unwrap();
        let cand = &r.candidates[0];
        assert_eq!(cand.first_lines.len(), 50);
    }

    #[test]
    fn scan_priority_spec_over_build_files() {
        // 即使有 build 文件,有 spec 也优先 A
        let dir = temp_dir("priority");
        fs::write(dir.join("AGENTS.md"), "spec").unwrap();
        fs::write(dir.join("Cargo.toml"), "[package]").unwrap();
        let r = InitScanner::scan(dir.to_str().unwrap()).unwrap();
        assert_eq!(r.scenario, "A");
    }
}
