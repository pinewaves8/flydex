use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Flydex 记忆系统（6.1）
///
/// 分层记忆：
/// - 用户记忆（L1）：`~/.flydex/MEMORY.md`（跨项目全局偏好/约定）
/// - 项目记忆（L2）：`<workdir>/.flydex/MEMORY.md`（自动沉淀 + 用户可编辑）
/// - 审计日志：`~/.flydex/memory-audit.jsonl`（沉淀/编辑记录，可追溯）
///
/// 说明：`<workdir>/CLAUDE.md` 由 codex CLI 原生自动读取（用户主动维护的静态约定），
/// 本服务不写入它，职责分离。
pub struct MemoryService;

/// 单条记忆注入的最大字符数（防止超大记忆文件拖慢每次请求）
pub const MAX_INJECT_CHARS: usize = 6000;

impl MemoryService {
    /// 用户级记忆文件
    pub fn user_memory_file() -> PathBuf {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        home.join(".flydex").join("MEMORY.md")
    }

    /// 项目级记忆文件
    pub fn project_memory_file(workdir: &str) -> PathBuf {
        Path::new(workdir).join(".flydex").join("MEMORY.md")
    }

    /// 审计日志文件
    fn audit_file() -> PathBuf {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        home.join(".flydex").join("memory-audit.jsonl")
    }

    fn now_ms() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    }

    /// 读取记忆文件（不存在返回空串）
    fn read_memory(path: &Path) -> String {
        fs::read_to_string(path).unwrap_or_default()
    }

    /// 读取用户记忆
    pub fn load_user_memory() -> String {
        Self::read_memory(&Self::user_memory_file())
    }

    /// 读取项目记忆
    pub fn load_project_memory(workdir: &str) -> String {
        Self::read_memory(&Self::project_memory_file(workdir))
    }

    /// 追加一条记忆（按分区标题分组 + 去重合并）。
    ///
    /// - 同名 section 自动聚合（历史重复段收敛为一个段，段内重复行去重）；
    /// - 同 section 内已含相同内容块则跳过写入（去重），审计记录 dup=true。
    pub fn append_memory(
        path: &Path,
        section: &str,
        content: &str,
        source: &str,
    ) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建记忆目录失败: {}", e))?;
        }
        let existing = Self::read_memory(path);
        let (out, dup) = Self::upsert_section(&existing, section, content);
        fs::write(path, out).map_err(|e| format!("写入记忆失败: {}", e))?;

        // 审计（尽力而为，失败不影响主流程；dup 标记本次是否因重复而跳过）
        let audit = format!(
            "{{\"ts\":{},\"file\":\"{}\",\"section\":\"{}\",\"source\":\"{}\",\"len\":{},\"dup\":{}}}\n",
            Self::now_ms(),
            path.display().to_string().replace('\\', "\\\\"),
            section,
            source,
            content.trim().len(),
            dup
        );
        if let Some(parent) = Self::audit_file().parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(Self::audit_file())
            .and_then(|mut f| f.write_all(audit.as_bytes()));

        Ok(())
    }

    /// 解析记忆文本，按 `## <section>` 分区；同名分区聚合 + 行级去重，
    /// 并把新内容合并/去重。返回 (新完整文本, 内容是否因重复而跳过)。
    pub fn upsert_section(existing: &str, section: &str, content: &str) -> (String, bool) {
        // 1) 解析现有 section
        let mut raw: Vec<(String, String)> = Vec::new();
        let mut cur_name: Option<String> = None;
        let mut cur_body = String::new();
        for line in existing.lines() {
            if let Some(rest) = line.strip_prefix("## ") {
                if let Some(n) = cur_name.take() {
                    raw.push((n, std::mem::take(&mut cur_body)));
                }
                cur_name = Some(rest.trim().to_string());
            } else {
                cur_body.push_str(line);
                cur_body.push('\n');
            }
        }
        if let Some(n) = cur_name.take() {
            raw.push((n, cur_body));
        }

        // 2) 聚合同名 section + 段内行级去重（同名 section 共享去重集合，跨段收敛）
        let mut agg: Vec<(String, String)> = Vec::new();
        let mut seen_map: std::collections::HashMap<
            String,
            std::collections::HashSet<String>,
        > = std::collections::HashMap::new();
        for (name, body) in raw {
            if name.trim().is_empty() {
                continue;
            }
            let mut dedup = String::new();
            let seen = seen_map.entry(name.clone()).or_default();
            for line in body.lines() {
                let key = line.trim().to_string();
                if !key.is_empty() && !seen.insert(key) {
                    continue;
                }
                dedup.push_str(line);
                dedup.push('\n');
            }
            let dt = dedup.trim().to_string();
            if let Some(entry) = agg.iter_mut().find(|(n, _)| n == &name) {
                if !dt.is_empty() {
                    entry.1.push('\n');
                    entry.1.push_str(&dt);
                }
            } else {
                agg.push((name, dt));
            }
        }

        // 3) 合并/去重新内容
        let ct = content.trim();
        let mut dup = false;
        let mut found = false;
        for (name, body) in agg.iter_mut() {
            if name == section {
                found = true;
                if !ct.is_empty() && body.trim().contains(ct) {
                    dup = true;
                } else {
                    if !body.trim().is_empty() {
                        body.push('\n');
                    }
                    body.push_str(ct);
                }
            }
        }
        if !found {
            agg.push((section.to_string(), ct.to_string()));
        }

        // 4) 输出
        let mut out = String::new();
        for (i, (name, body)) in agg.iter().enumerate() {
            if i > 0 {
                out.push('\n');
            }
            out.push_str("## ");
            out.push_str(name);
            out.push('\n');
            let bt = body.trim_end();
            if !bt.is_empty() {
                out.push('\n');
                out.push_str(bt);
                out.push('\n');
            }
        }
        (out, dup)
    }

    /// 覆盖写入记忆文件（记忆管理面板编辑用）
    pub fn write_memory(path: &Path, content: &str) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建记忆目录失败: {}", e))?;
        }
        fs::write(path, content).map_err(|e| format!("写入记忆失败: {}", e))?;
        // 审计（编辑记录）
        let audit = format!(
            "{{\"ts\":{},\"file\":\"{}\",\"section\":\"edit\",\"source\":\"manual\",\"len\":{}}}\n",
            Self::now_ms(),
            path.display().to_string().replace('\\', "\\\\"),
            content.trim().len()
        );
        if let Some(parent) = Self::audit_file().parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(Self::audit_file())
            .and_then(|mut f| f.write_all(audit.as_bytes()));
        Ok(())
    }

    /// 构建注入记忆块（用于 codex final_command 前缀）
    ///
    /// 返回 `[用户记忆]\n...` + `[项目记忆]\n...` 的组合文本；
    /// 每层各截断到 MAX_INJECT_CHARS 防止超长。全空返回空串。
    pub fn build_inject_block(workdir: Option<&str>) -> String {
        let mut block = String::new();

        let user = Self::load_user_memory();
        if !user.trim().is_empty() {
            block.push_str("[用户记忆]\n");
            block.push_str(&truncate(user.trim(), MAX_INJECT_CHARS));
            block.push('\n');
        }

        if let Some(dir) = workdir {
            if !dir.trim().is_empty() {
                let project = Self::load_project_memory(dir);
                if !project.trim().is_empty() {
                    if !block.is_empty() {
                        block.push('\n');
                    }
                    block.push_str("[项目记忆]\n");
                    block.push_str(&truncate(project.trim(), MAX_INJECT_CHARS));
                    block.push('\n');
                }
            }
        }

        block
    }
}

/// 截断到 max 字符，超出加省略提示
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push_str("\n…（记忆过长已截断，请在记忆管理面板精简）");
        out
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_new_section() {
        let (out, dup) = MemoryService::upsert_section("", "skills", "[a] x");
        assert!(!dup);
        assert!(out.contains("## skills"));
        assert!(out.contains("[a] x"));
    }

    #[test]
    fn upsert_same_section_appends() {
        let (out, _) = MemoryService::upsert_section("", "skills", "[a] x");
        let (out2, dup) = MemoryService::upsert_section(&out, "skills", "[b] y");
        assert!(!dup);
        assert_eq!(out2.matches("## skills").count(), 1, "只应有一个 skills 段");
        assert!(out2.contains("[a] x"));
        assert!(out2.contains("[b] y"));
    }

    #[test]
    fn upsert_duplicate_skipped() {
        let (out, _) = MemoryService::upsert_section("", "skills", "[a] x");
        let (out2, dup) = MemoryService::upsert_section(&out, "skills", "[a] x");
        assert!(dup, "重复内容应跳过");
        assert_eq!(out2, out, "重复写入不应改变文件");
    }

    #[test]
    fn upsert_merges_historical_dup_sections() {
        let existing = "## skills\n\n[a] x\n\n## skills\n\n[a] x\n";
        let (out, dup) = MemoryService::upsert_section(existing, "skills", "[a] x");
        assert!(dup);
        assert_eq!(out.matches("## skills").count(), 1, "历史重复段应收敛为一个");
        // 段内重复行也去重
        assert_eq!(out.matches("[a] x").count(), 1);
    }

    #[test]
    fn upsert_different_sections_kept() {
        let (out, _) = MemoryService::upsert_section("", "skills", "[a] x");
        let (out2, _) = MemoryService::upsert_section(&out, "prefs", "p=y");
        assert!(out2.contains("## skills"));
        assert!(out2.contains("## prefs"));
    }
}
