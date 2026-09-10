//! codex thread / project 的 DTO
//!
//! 刻意**只对「列表行」做强类型**(ThreadRow),`Turn` / `ThreadItem` 一律以
//! `serde_json::Value` 透传给前端 —— 这两者是 codex 演进最活跃的部分(18 种 item 变体),
//! 在 Rust 侧复刻它们的完整字段会立刻和上游耦合。前端已有 TS 类型描述渲染需要的那部分。
//!
//! 单位换算集中在这里:`Thread.created_at/updated_at` 在 codex 是 **Unix 秒**,
//! Flydex 前端统一用**毫秒**(所有 `relativeTime()`、`Date` 构造都按毫秒)。

use serde::{Deserialize, Serialize};

/// 去掉 Windows 的扩展长度前缀
///
/// codex 记录的 cwd 是 `\\?\C:\llm\flydex`(verbatim 形式),而 Flydex 项目的
/// path 是人写的 `C:\llm\flydex` —— 不归一就永远匹配不上,「同一目录」会被当成
/// 两个地方(实测线程列表里绝大多数 cwd 都是带前缀的形式)。
///
/// - `\\?\C:\x`          → `C:\x`
/// - `\\?\UNC\srv\share` → `\\srv\share`(verbatim 的 UNC 形式)
/// - 其它原样返回(含非 Windows 路径)
pub fn strip_verbatim_prefix(p: &str) -> String {
    if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = p.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    p.to_string()
}

/// 会话列表行(来自 `thread/list`)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRow {
    pub id: String,
    /// 用户显式设置的标题(可能为 null)
    pub name: Option<String>,
    /// 首条用户消息(用于 `name` 缺省时的展示标题)
    pub preview: String,
    /// fork 来源线程;用于 Sidebar 的 fork 树
    pub forked_from_id: Option<String>,
    pub parent_thread_id: Option<String>,
    /// 所属 codex project(uuid);null = 未归属
    pub project_id: Option<String>,
    /// **毫秒**(已从 codex 的秒换算)
    pub created_at: i64,
    /// **毫秒**(已从 codex 的秒换算)
    pub updated_at: i64,
    pub cwd: String,
    pub model_provider: String,
    /// `notLoaded` / `idle` / `systemError` / `active`
    pub status: String,
    /// 是否已归档(回收站)
    pub archived: bool,
}

impl ThreadRow {
    /// 从 `thread/list` 返回的 Thread JSON 构造
    pub fn from_value(v: &serde_json::Value) -> Option<Self> {
        let id = v.get("id")?.as_str()?.to_string();
        let secs_to_ms = |key: &str| -> i64 {
            v.get(key).and_then(|x| x.as_i64()).unwrap_or(0) * 1000
        };
        Some(Self {
            id,
            name: v
                .get("name")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            preview: v
                .get("preview")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            forked_from_id: v
                .get("forkedFromId")
                .and_then(|x| x.as_str())
                .map(str::to_string),
            parent_thread_id: v
                .get("parentThreadId")
                .and_then(|x| x.as_str())
                .map(str::to_string),
            project_id: v
                .get("projectId")
                .and_then(|x| x.as_str())
                .map(str::to_string),
            created_at: secs_to_ms("createdAt"),
            updated_at: secs_to_ms("updatedAt"),
            cwd: strip_verbatim_prefix(v.get("cwd").and_then(|x| x.as_str()).unwrap_or("")),
            model_provider: v
                .get("modelProvider")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            status: v
                .get("status")
                .and_then(|s| s.get("type").or(Some(s)))
                .and_then(|s| s.as_str())
                .unwrap_or("notLoaded")
                .to_string(),
            archived: v
                .get("archived")
                .and_then(|x| x.as_bool())
                .unwrap_or(false),
        })
    }

    /// 展示标题:`name` 优先,回退首条用户消息
    pub fn display_title(&self) -> String {
        match &self.name {
            Some(n) if !n.trim().is_empty() => n.clone(),
            _ => {
                let p = self.preview.replace(['\n', '\r'], " ").trim().to_string();
                if p.is_empty() {
                    "未命名会话".to_string()
                } else if p.chars().count() > 40 {
                    p.chars().take(40).collect::<String>() + "…"
                } else {
                    p
                }
            }
        }
    }
}

/// 会话搜索命中(一级:`thread/search`)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSearchHit {
    pub thread_id: String,
    pub title: String,
    pub project_id: Option<String>,
    /// 线程的工作目录 —— 前端软过滤要用:未归属但有 cwd 的历史会话也要能被搜到
    pub cwd: String,
    /// **毫秒**
    pub updated_at: i64,
    pub snippet: String,
    pub archived: bool,
}

/// 命中位置(二级:`thread/searchOccurrences`),用于跳转定位
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadOccurrence {
    pub turn_id: String,
    pub item_id: String,
    pub snippet: String,
}

/// codex project(`project/list` / `project/create` 返回)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProject {
    pub id: String,
    pub name: String,
    /// 主根目录(取 roots[0]);codex 支持多根,Flydex 只用第一个
    pub root: String,
    /// Flydex 侧项目 id(从 metadata 读回,用于三路匹配)
    pub flydex_project_id: Option<String>,
    /// **毫秒**
    pub created_at: i64,
    pub updated_at: i64,
}

impl CodexProject {
    pub fn from_value(v: &serde_json::Value) -> Option<Self> {
        let id = v.get("id")?.as_str()?.to_string();
        let root = strip_verbatim_prefix(
            v.get("roots")
                .and_then(|r| r.as_array())
                .and_then(|a| a.first())
                .and_then(|r| r.get("path"))
                .and_then(|p| p.as_str())
                .unwrap_or(""),
        );
        let secs_to_ms = |key: &str| -> i64 {
            v.get(key).and_then(|x| x.as_i64()).unwrap_or(0) * 1000
        };
        Some(Self {
            id,
            name: v
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            root,
            flydex_project_id: v
                .get("metadata")
                .and_then(|m| m.get("flydex.projectId"))
                .and_then(|x| x.as_str())
                .map(str::to_string),
            created_at: secs_to_ms("createdAt"),
            updated_at: secs_to_ms("updatedAt"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_row_converts_seconds_to_millis() {
        let v = serde_json::json!({
            "id": "01a0-abc",
            "name": "我的会话",
            "preview": "hello",
            "forkedFromId": "01a0-parent",
            "projectId": "proj-uuid",
            "createdAt": 1_789_000_000,
            "updatedAt": 1_789_000_120,
            "cwd": "C:\\llm\\flydex",
            "modelProvider": "flydex_deepseek",
            "status": { "type": "idle" }
        });
        let row = ThreadRow::from_value(&v).expect("应解析成功");
        assert_eq!(row.id, "01a0-abc");
        assert_eq!(row.name.as_deref(), Some("我的会话"));
        assert_eq!(row.forked_from_id.as_deref(), Some("01a0-parent"));
        assert_eq!(row.project_id.as_deref(), Some("proj-uuid"));
        // 秒 → 毫秒
        assert_eq!(row.created_at, 1_789_000_000_000);
        assert_eq!(row.updated_at, 1_789_000_120_000);
        assert_eq!(row.status, "idle");
    }

    #[test]
    fn display_title_prefers_name_then_preview() {
        let mut v = serde_json::json!({ "id": "t1", "preview": "帮我改一下这个文件" });
        let row = ThreadRow::from_value(&v).unwrap();
        assert_eq!(row.display_title(), "帮我改一下这个文件");

        v["name"] = serde_json::json!("显式标题");
        let row = ThreadRow::from_value(&v).unwrap();
        assert_eq!(row.display_title(), "显式标题");
    }

    #[test]
    fn display_title_handles_empty_preview() {
        let v = serde_json::json!({ "id": "t2", "preview": "" });
        let row = ThreadRow::from_value(&v).unwrap();
        assert_eq!(row.display_title(), "未命名会话");
    }

    #[test]
    fn display_title_truncates_long_preview() {
        let long = "字".repeat(80);
        let v = serde_json::json!({ "id": "t3", "preview": long });
        let row = ThreadRow::from_value(&v).unwrap();
        let t = row.display_title();
        // 40 字 + 省略号(按字符数,不是字节数 —— 中文要注意)
        assert_eq!(t.chars().count(), 41);
        assert!(t.ends_with('…'));
    }

    #[test]
    fn codex_project_reads_metadata_and_first_root() {
        let v = serde_json::json!({
            "id": "prj-uuid",
            "name": "flydex",
            "roots": [{ "path": "C:\\llm\\flydex" }, { "path": "C:\\other" }],
            "metadata": { "flydex.projectId": "proj_123" },
            "createdAt": 1_789_000_000,
            "updatedAt": 1_789_000_000
        });
        let p = CodexProject::from_value(&v).unwrap();
        assert_eq!(p.root, "C:\\llm\\flydex");
        assert_eq!(p.flydex_project_id.as_deref(), Some("proj_123"));
        assert_eq!(p.created_at, 1_789_000_000_000);
    }

    #[test]
    fn strip_verbatim_handles_windows_forms() {
        // 实测主线:codex 的 cwd 带 verbatim 前缀(两个反斜杠 + 问号 + 反斜杠),
        // 而项目 path 不带 —— 两者必须能归一成同一个字符串
        assert_eq!(strip_verbatim_prefix(r"\\?\C:\llm\flydex"), r"C:\llm\flydex");
        // 已归一的形式必须幂等(会被反复调用)
        assert_eq!(strip_verbatim_prefix(r"C:\llm\flydex"), r"C:\llm\flydex");
        // 单反斜杠的 `\?\` 是**另一种**形式,不该被误删(删了会把 `\?\x` 变成 `x`)
        assert_eq!(strip_verbatim_prefix(r"\?\C:\x"), r"\?\C:\x");
        // UNC:verbatim 形式要还原成普通 UNC,而不是把 \\?\UNC\ 一并删掉
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share"),
            r"\\server\share"
        );
        // 非 Windows 路径原样
        assert_eq!(strip_verbatim_prefix("/home/u/p"), "/home/u/p");
        assert_eq!(strip_verbatim_prefix(""), "");
    }

}
