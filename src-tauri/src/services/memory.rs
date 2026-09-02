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

    /// 追加一条记忆到指定文件末尾（按分区标题分组）
    ///
    /// 简单实现：在文件末尾追加 `## <section>` 分区与内容。
    /// source 用于审计溯源（如 session id / manual）。
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
        let mut out = String::new();
        if !existing.trim().is_empty() {
            out.push_str(existing.trim_end());
            out.push_str("\n\n");
        }
        out.push_str(&format!("## {}\n\n", section));
        out.push_str(content.trim());
        out.push('\n');
        fs::write(path, out).map_err(|e| format!("写入记忆失败: {}", e))?;

        // 审计（尽力而为，失败不影响主流程）
        let audit = format!(
            "{{\"ts\":{},\"file\":\"{}\",\"section\":\"{}\",\"source\":\"{}\",\"len\":{}}}\n",
            Self::now_ms(),
            path.display().to_string().replace('\\', "\\\\"),
            section,
            source,
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
