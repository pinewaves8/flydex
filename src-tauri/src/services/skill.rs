use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Skill 来源
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillSource {
    Builtin,
    Project,
    Mcp,
}

/// Skill 界面配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInterface {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brand_color: Option<String>,
}

/// Skill 定义（Rust 侧）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDefinition {
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub short_description: Option<String>,
    #[serde(default)]
    pub triggers: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interface: Option<SkillInterface>,
    pub source: SkillSource,
    /// SKILL.md 文件路径（项目技能）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// 关联的 MCP server 名（MCP 衍生技能）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_server: Option<String>,
    /// 注入给 codex 的指令文本
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default)]
    pub enabled: bool,
}

/// 解析 SKILL.md 的 YAML frontmatter
fn parse_frontmatter(content: &str) -> Option<serde_yaml::Value> {
    let mut lines = content.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    let mut frontmatter = String::new();
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        frontmatter.push_str(line);
        frontmatter.push('\n');
    }
    serde_yaml::from_str(&frontmatter).ok()
}

/// 从 SKILL.md 文件解析 SkillDefinition
fn parse_skill_file(path: &Path) -> Option<SkillDefinition> {
    let content = fs::read_to_string(path).ok()?;
    let yaml = parse_frontmatter(&content)?;
    let map = yaml.as_mapping()?;

    let name = map
        .get("name")?
        .as_str()?
        .to_string();

    let description = map
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let short_description = map
        .get("short-description")
        .or_else(|| map.get("short_description"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let triggers: Vec<String> = map
        .get("triggers")
        .and_then(|v| v.as_sequence())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let interface = map.get("interface").and_then(|v| {
        let m = v.as_mapping()?;
        Some(SkillInterface {
            display_name: m
                .get("display-name")
                .or_else(|| m.get("display_name"))
                .and_then(|v| v.as_str().map(|s| s.to_string())),
            icon: m.get("icon").and_then(|v| v.as_str().map(|s| s.to_string())),
            brand_color: m
                .get("brand-color")
                .or_else(|| m.get("brand_color"))
                .and_then(|v| v.as_str().map(|s| s.to_string())),
        })
    });

    Some(SkillDefinition {
        name,
        description,
        short_description,
        triggers,
        interface,
        source: SkillSource::Project,
        path: Some(path.to_string_lossy().to_string()),
        mcp_server: None,
        prompt: Some(content),
        enabled: true,
    })
}

/// 扫描项目目录下的所有技能（.codex/skills/*/SKILL.md）
pub fn scan_project_skills(base_dir: &str) -> Result<Vec<SkillDefinition>, String> {
    let skills_dir = Path::new(base_dir).join(".codex").join("skills");
    if !skills_dir.exists() {
        return Ok(Vec::new());
    }

    let mut skills = Vec::new();
    let entries = fs::read_dir(&skills_dir).map_err(|e| format!("读取 skills 目录失败: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        if !skill_md.exists() {
            continue;
        }
        if let Some(skill) = parse_skill_file(&skill_md) {
            skills.push(skill);
        }
    }

    Ok(skills)
}

/// 读取 SKILL.md 全文
pub fn read_skill_content(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("读取技能文件失败: {}", e))
}


// ===== 6.5 自进化闭环：skill 沉淀（校验门禁 + 创建/更新 + 删除 + 审计/回滚） =====

use std::io::Write;

/// 校验报告
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub ok: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// 审计日志落盘（与 appserver 日志一致）
fn audit_log(line: &str) {
    eprintln!("{line}");
    let log = crate::services::storage::Storage::log_file("flydex-appserver.log");
    if let Some(dir) = log.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log)
    {
        let _ = writeln!(f, "{line}");
    }
}

/// 校验 SKILL.md 是否可入库（校验门禁）：
/// - frontmatter 必须含合法 name + description
/// - 正文非空且足够详细（>= 50 字符）
/// - 可复现性启发式：正文含标题 / 编号或列表步骤 / 行内代码或命令
pub fn validate_skill_content(content: &str) -> ValidationReport {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    let yaml = parse_frontmatter(content);
    match &yaml {
        None => errors.push("缺少 YAML frontmatter（须以 --- 开头并以 --- 结束）".to_string()),
        Some(v) => {
            let map = v.as_mapping();
            let name_ok = map
                .and_then(|m| m.get("name"))
                .and_then(|x| x.as_str())
                .map(|s| !s.trim().is_empty() && !s.trim().contains(char::is_whitespace))
                .unwrap_or(false);
            if !name_ok {
                errors.push("frontmatter 缺少合法 name 字段（非空且不含空白）".to_string());
            }
            let desc_ok = map
                .and_then(|m| m.get("description"))
                .and_then(|x| x.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            if !desc_ok {
                errors.push("frontmatter 缺少 description 字段".to_string());
            }
        }
    }

    let body = content.split("\n---").nth(1).unwrap_or(content);
    if body.trim().is_empty() {
        errors.push("正文为空".to_string());
    } else if body.trim().chars().count() < 50 {
        warnings.push("正文过短（<50 字符），可能缺乏可执行细节".to_string());
    }
    // 可复现性启发式
    let has_structure = body.contains("## ")
        || body.contains("# ")
        || body.lines().any(|l| {
            let t = l.trim_start();
            t.starts_with("1.") || t.starts_with("- ") || t.starts_with("* ")
        })
        || body.contains('`');
    if !has_structure {
        warnings.push("正文缺少标题/步骤/代码结构，可能不可复现".to_string());
    }

    let ok = errors.is_empty();
    ValidationReport {
        ok,
        errors,
        warnings,
    }
}

/// 创建或更新 skill：写 `.codex/skills/<name>/SKILL.md`。
/// 已存在同名 skill 时先备份旧版到 `logs/skill-trash/`（回滚）。返回校验报告。
pub fn create_skill(base_dir: &str, name: &str, content: &str) -> Result<ValidationReport, String> {
    let report = validate_skill_content(content);
    if !report.ok {
        return Err(format!("校验未通过: {}", report.errors.join("; ")));
    }
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("非法技能名".to_string());
    }
    let dir = Path::new(base_dir).join(".codex").join("skills").join(name);
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    let target = dir.join("SKILL.md");
    if target.exists() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default();
        let trash = Path::new(base_dir).join("logs").join("skill-trash");
        let _ = fs::create_dir_all(&trash);
        let bak = trash.join(format!("{name}-{ts}.md"));
        let _ = fs::copy(&target, &bak);
        audit_log(&format!(
            "[flydex] skill update name={name} backup={}",
            bak.display()
        ));
    }
    fs::write(&target, content).map_err(|e| format!("写入 SKILL.md 失败: {e}"))?;
    audit_log(&format!(
        "[flydex] skill create name={name} path={}",
        target.display()
    ));
    Ok(report)
}

/// 删除 skill：先备份到 `logs/skill-trash/`（回滚），返回备份路径。
pub fn delete_skill(base_dir: &str, name: &str) -> Result<String, String> {
    let name = name.trim();
    let dir = Path::new(base_dir).join(".codex").join("skills").join(name);
    let target = dir.join("SKILL.md");
    if !target.exists() {
        return Err(format!("技能不存在: {name}"));
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let trash = Path::new(base_dir).join("logs").join("skill-trash");
    fs::create_dir_all(&trash).map_err(|e| format!("创建回收目录失败: {e}"))?;
    let bak = trash.join(format!("{name}-{ts}.md"));
    fs::copy(&target, &bak).map_err(|e| format!("备份失败: {e}"))?;
    fs::remove_dir_all(&dir).map_err(|e| format!("删除失败: {e}"))?;
    audit_log(&format!(
        "[flydex] skill delete name={name} backup={}",
        bak.display()
    ));
    Ok(bak.to_string_lossy().to_string())
}

/// 递归复制目录（skill 及其 assets）
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_all(&path, &target)?;
        } else {
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

/// 7.4.1 导入 skill：从 from_base/.codex/skills/<name> 复制到 to_base/.codex/skills/<name>（含 assets）。
/// 目标已存在同名 → 整个目录移到 to_base/logs/skill-trash/（回滚，复用 6.5 回收机制）。
/// 方向通用：from=项目 → to=市场/其他目录 即「导出」；from=市场/其他目录 → to=项目 即「导入」。
/// 返回 (目标路径, 校验报告)。校验宽松（来源 skill 已是可执行产物，仅提示不阻断）。
pub fn import_skill(
    from_base: &str,
    name: &str,
    to_base: &str,
) -> Result<(String, ValidationReport), String> {
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("非法技能名".to_string());
    }
    let src_dir = Path::new(from_base).join(".codex").join("skills").join(name);
    let src_md = src_dir.join("SKILL.md");
    if !src_md.exists() {
        return Err(format!("源技能不存在: {name}（{}）", src_dir.display()));
    }
    let content = fs::read_to_string(&src_md).unwrap_or_default();
    let report = validate_skill_content(&content);

    let dst_dir = Path::new(to_base).join(".codex").join("skills").join(name);
    if dst_dir.exists() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default();
        let trash = Path::new(to_base).join("logs").join("skill-trash");
        let _ = fs::create_dir_all(&trash);
        let bak = trash.join(format!("{name}-{ts}"));
        let _ = fs::rename(&dst_dir, &bak);
        audit_log(&format!(
            "[flydex] skill import overwrite name={name} backup={}",
            bak.display()
        ));
    }
    fs::create_dir_all(dst_dir.parent().unwrap()).map_err(|e| format!("创建目录失败: {e}"))?;
    copy_dir_all(&src_dir, &dst_dir).map_err(|e| format!("复制技能失败: {e}"))?;
    audit_log(&format!(
        "[flydex] skill import name={name} from={} to={}",
        src_dir.display(),
        dst_dir.display()
    ));
    Ok((dst_dir.to_string_lossy().to_string(), report))
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r###"---
name: my-skill
description: 测试技能
---

# 规则
1. 步骤一
2. 步骤二
"###;

    #[test]
    fn validate_ok() {
        let r = validate_skill_content(VALID);
        assert!(r.ok, "errors: {:?}", r.errors);
        assert!(r.errors.is_empty());
    }

    #[test]
    fn validate_missing_name() {
        let c = VALID.replace("name: my-skill", "xxx: yyy");
        let r = validate_skill_content(&c);
        assert!(!r.ok);
        assert!(r.errors.iter().any(|e| e.contains("name")), "errors: {:?}", r.errors);
    }

    #[test]
    fn validate_missing_desc() {
        let c = VALID.replace("description: 测试技能", "short: d");
        let r = validate_skill_content(&c);
        assert!(!r.ok);
        assert!(
            r.errors.iter().any(|e| e.contains("description")),
            "errors: {:?}",
            r.errors
        );
    }

    #[test]
    fn validate_empty_body() {
        let c = "---\nname: x\n---\n\n# t\n";
        let r = validate_skill_content(c);
        assert!(!r.ok);
    }

    #[test]
    fn validate_short_body_warns() {
        let c = "---\nname: x\ndescription: d\n---\n\n# hi\n";
        let r = validate_skill_content(c);
        // ok 但正文短 → warning
        assert!(r.ok);
        assert!(
            r.warnings.iter().any(|w| w.contains("正文过短")),
            "warnings: {:?}",
            r.warnings
        );
    }

    #[test]
    fn import_skill_copies_entire_dir() {
        // 临时目录构造源/目标项目结构，验证 SKILL.md + assets 一并复制
        let base = std::env::temp_dir().join(format!("flydex-skill-test-{}", std::process::id()));
        let from = base.join("src");
        let to = base.join("dst");
        let src_dir = from.join(".codex").join("skills").join("web-search");
        fs::create_dir_all(&src_dir).unwrap();
        fs::write(src_dir.join("SKILL.md"), VALID).unwrap();
        fs::write(src_dir.join("helper.md"), "asset").unwrap();

        let (target, report) =
            import_skill(&from.to_string_lossy(), "web-search", &to.to_string_lossy()).unwrap();
        assert!(report.ok, "errors: {:?}", report.errors);
        assert!(Path::new(&target).join("SKILL.md").exists());
        assert!(Path::new(&target).join("helper.md").exists(), "assets 应一并复制");
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn import_skill_missing_source_errors() {
        let base =
            std::env::temp_dir().join(format!("flydex-skill-test-missing-{}", std::process::id()));
        let from = base.join("src");
        let r = import_skill(&from.to_string_lossy(), "nope", &base.to_string_lossy());
        assert!(r.is_err(), "源 skill 不存在应报错");
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn import_skill_overwrites_backs_up() {
        let base =
            std::env::temp_dir().join(format!("flydex-skill-test-ovw-{}", std::process::id()));
        let from = base.join("src");
        let to = base.join("dst");
        let src_dir = from.join(".codex").join("skills").join("my-skill");
        fs::create_dir_all(&src_dir).unwrap();
        fs::write(src_dir.join("SKILL.md"), VALID).unwrap();
        let dst_dir = to.join(".codex").join("skills").join("my-skill");
        fs::create_dir_all(&dst_dir).unwrap();
        fs::write(dst_dir.join("SKILL.md"), "---\nname: my-skill\ndescription: old\n---\n# old").unwrap();

        let (target, _) =
            import_skill(&from.to_string_lossy(), "my-skill", &to.to_string_lossy()).unwrap();
        assert!(Path::new(&target).join("SKILL.md").exists());
        let trash = to.join("logs").join("skill-trash");
        let has_backup = fs::read_dir(&trash)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false);
        assert!(has_backup, "覆盖时应回收旧版");
        fs::remove_dir_all(&base).ok();
    }
}
