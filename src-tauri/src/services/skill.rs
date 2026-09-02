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

    // 从 frontmatter 之后提取 prompt（直到文件末尾或第一个 ## 之前的正文）
    let prompt = Some(content.clone());

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