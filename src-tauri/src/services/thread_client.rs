//! codex `thread/*` 与 `project/*` 的 RPC 封装
//!
//! 这一层只做三件事:**组装参数**、**调用 `AppServerClient::request`**、**把列表行规整成 DTO**。
//! 不做业务决策(归属、级联、幂等) —— 那些在 `project_map` 与命令层。
//!
//! 注意:所有 `project/*`、`thread/search*`、`thread/turns|items/list`、`thread/revert`
//! 都是 codex 的 **experimental** 接口,需要 `initialize` 时声明
//! `capabilities.experimentalApi = true`(`AppServerClient::ensure` 已带该声明)。

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::models::thread::{
    CodexProject, FuzzyFileHit, ThreadOccurrence, ThreadRow, ThreadSearchHit,
};
use crate::services::appserver_client::{map_item, AppServerClient};

/// 写进 codex project metadata 的键 —— 用于把 Flydex 项目 id 与 codex project 关联
pub const FLYDEX_PROJECT_META_KEY: &str = "flydex.projectId";

/// `thread/list` 单页最大条数(codex 侧 clamp 到 [1,100])
const PAGE_LIMIT: u32 = 100;

/// 要列出的会话来源
///
/// **必须显式传**:不传时 codex 只给「交互式来源」,实测被截在 50 条 ——
/// `codex exec` 时代产生的会话(本项目早期全是这种)完全看不到,用户会以为
/// 历史对话丢了。显式列出后分页才生效,能翻到全部。
///
/// 注意取值是**混合命名**(`appServer`/`subAgent`),不是全 snake_case,
/// 写错会直接报 `unknown variant`。
///
/// 子代理线程刻意不列 —— 它们是执行细节,不属于用户视角的"对话"。
const SOURCE_KINDS: &[&str] = &["cli", "vscode", "exec", "appServer"];
/// 列表翻页上限,防止异常情况下无限循环
const MAX_PAGES: u32 = 20;

/// 归一化一个 turn,让前端只面对一种形状:
///
/// 1. `items` 走 [`map_item`](两条路径共用一份映射,见其文档)
/// 2. `startedAt` / `completedAt` 由 codex 的 **Unix 秒**换成本项目的**毫秒**
///    (陷阱 G:不换算的话前端相对时间会显示成 1970 年)
fn normalize_turn(turn: &Value) -> Value {
    let mut t = turn.clone();
    if let Some(items) = t.get_mut("items").and_then(|i| i.as_array_mut()) {
        for it in items.iter_mut() {
            let mapped = map_item(it);
            *it = mapped;
        }
    }
    for key in ["startedAt", "completedAt"] {
        if let Some(secs) = t.get(key).and_then(|v| v.as_i64()) {
            t[key] = json!(secs.saturating_mul(1000));
        }
    }
    t
}

pub struct ThreadClient;

impl ThreadClient {
    fn client(app: &AppHandle) -> Result<std::sync::Arc<AppServerClient>, String> {
        AppServerClient::ensure(app.clone())
    }

    // ── thread 读 ────────────────────────────────────────────────

    /// 列出线程(单页)。`project_id = Some(Some(id))` 表示按项目过滤。
    fn list_page(
        app: &AppHandle,
        cursor: Option<&str>,
        archived: bool,
        project_id: Option<&str>,
        search_term: Option<&str>,
    ) -> Result<(Vec<ThreadRow>, Option<String>), String> {
        let mut params = json!({
            // 默认是 created_at,而 Flydex 一直按「最近更新」排序
            "sortKey": "updated_at",
            "sortDirection": "desc",
            "limit": PAGE_LIMIT,
            "archived": archived,
            "sourceKinds": SOURCE_KINDS,
            // 跳过 JSONL 扫描修复元数据,直接读 state db(列表足够用,快得多)
            "useStateDbOnly": true,
        });
        if let Some(c) = cursor {
            params["cursor"] = json!(c);
        }
        if let Some(pid) = project_id {
            params["projectId"] = json!(pid);
        }
        if let Some(q) = search_term {
            params["searchTerm"] = json!(q);
        }

        let resp = Self::client(app)?.request("thread/list", Some(params))?;
        let rows = resp
            .get("data")
            .and_then(|d| d.as_array())
            .map(|arr| arr.iter().filter_map(ThreadRow::from_value).collect())
            .unwrap_or_default();
        let next = resp
            .get("nextCursor")
            .and_then(|c| c.as_str())
            .map(str::to_string);
        Ok((rows, next))
    }

    /// 列出线程并翻完所有页(Flydex 侧边栏需要完整列表来建 fork 树)
    pub fn list_all(
        app: &AppHandle,
        archived: bool,
        project_id: Option<&str>,
    ) -> Result<Vec<ThreadRow>, String> {
        let mut out = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let (mut rows, next) =
                Self::list_page(app, cursor.as_deref(), archived, project_id, None)?;
            out.append(&mut rows);
            match next {
                Some(c) if !c.is_empty() => cursor = Some(c),
                _ => break,
            }
        }
        Ok(out)
    }

    /// 读线程元数据。`include_turns` 必须为 false —— 传 true 会**全量无分页**返回所有 turns。
    pub fn read_meta(app: &AppHandle, thread_id: &str) -> Result<Option<ThreadRow>, String> {
        let resp = Self::client(app)?.request(
            "thread/read",
            Some(json!({ "threadId": thread_id, "includeTurns": false })),
        )?;
        Ok(resp.get("thread").and_then(ThreadRow::from_value))
    }

    /// 取一页 turns(**必须显式传 `itemsView: "full"`**)
    ///
    /// 陷阱:`thread/turns/list` 的 `itemsView` **参数缺省是 `Summary`**
    /// (协议里 `TurnItemsView::default()` 却是 `Full`,但参数缺省走 Summary)。
    /// 不传的话每轮只会返回首条 userMessage + 末条 agentMessage。
    ///
    /// 返回 `(turns, nextCursor, backwardsCursor)`,turns 原样透传给前端。
    pub fn turns_page(
        app: &AppHandle,
        thread_id: &str,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<(Vec<Value>, Option<String>, Option<String>), String> {
        let mut params = json!({
            "threadId": thread_id,
            "sortDirection": "desc",
            "itemsView": "full",
            "limit": limit,
        });
        if let Some(c) = cursor {
            params["cursor"] = json!(c);
        }
        let resp = Self::client(app)?.request("thread/turns/list", Some(params))?;
        let turns = resp
            .get("data")
            .and_then(|d| d.as_array())
            .map(|arr| arr.iter().map(normalize_turn).collect())
            .unwrap_or_default();
        let next = resp
            .get("nextCursor")
            .and_then(|c| c.as_str())
            .map(str::to_string);
        let backwards = resp
            .get("backwardsCursor")
            .and_then(|c| c.as_str())
            .map(str::to_string);
        Ok((turns, next, backwards))
    }

    /// 打开会话的首屏:最新若干轮
    pub fn recent_turns(
        app: &AppHandle,
        thread_id: &str,
        limit: u32,
    ) -> Result<(Vec<Value>, Option<String>), String> {
        let (turns, _next, backwards) = Self::turns_page(app, thread_id, None, limit)?;
        Ok((turns, backwards))
    }

    /// 取**全部** turns(时间正序)
    ///
    /// 导出用:codex 没有导出接口,所以只能自己把历史翻完再渲染。
    /// `max_pages` 兜住异常数据(每页 100 轮,50 页 = 5000 轮已远超实际)。
    pub fn all_turns(
        app: &AppHandle,
        thread_id: &str,
        max_pages: u32,
    ) -> Result<Vec<Value>, String> {
        let mut collected: Vec<Value> = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..max_pages {
            let (mut turns, _next, backwards) =
                Self::turns_page(app, thread_id, cursor.as_deref(), 100)?;
            collected.append(&mut turns);
            match backwards {
                Some(c) if !c.is_empty() => cursor = Some(c),
                _ => break,
            }
        }
        // 分页是倒序取的,导出要正序
        collected.reverse();
        Ok(collected)
    }

    /// 继续往前翻(用 `backwardsCursor`)
    pub fn earlier_turns(
        app: &AppHandle,
        thread_id: &str,
        backwards_cursor: &str,
        limit: u32,
    ) -> Result<(Vec<Value>, Option<String>), String> {
        let (turns, _next, backwards) =
            Self::turns_page(app, thread_id, Some(backwards_cursor), limit)?;
        Ok((turns, backwards))
    }

    // ── thread 写 ────────────────────────────────────────────────

    pub fn set_name(app: &AppHandle, thread_id: &str, name: &str) -> Result<(), String> {
        Self::client(app)?
            .request(
                "thread/name/set",
                Some(json!({ "threadId": thread_id, "name": name })),
            )
            .map(|_| ())
    }

    /// 归档(收回回收站)。可逆,且 codex 会把 rollout 搬到 `archived_sessions/`。
    pub fn archive(app: &AppHandle, thread_id: &str) -> Result<(), String> {
        Self::client(app)?
            .request("thread/archive", Some(json!({ "threadId": thread_id })))
            .map(|_| ())
    }

    pub fn unarchive(app: &AppHandle, thread_id: &str) -> Result<(), String> {
        Self::client(app)?
            .request("thread/unarchive", Some(json!({ "threadId": thread_id })))
            .map(|_| ())
    }

    /// **硬删除,不可逆**。codex **不会**级联删除分支,也不会因为有分支而拒绝
    /// (实测,见 `thread_cascade` 的模块说明)—— 想要"连分支一起删"必须由调用方
    /// 自己按叶子优先的顺序逐个删,否则会留下孤儿分支。
    pub fn delete(app: &AppHandle, thread_id: &str) -> Result<(), String> {
        Self::client(app)?
            .request("thread/delete", Some(json!({ "threadId": thread_id })))
            .map(|_| ())
    }

    /// 从某轮之后分叉。`last_turn_id` 含该轮;`before_turn_id` 不含(两者互斥)。
    ///
    /// 注意:`ThreadForkParams` **没有 projectId**(与 `thread/start` 同一处协议缺口),
    /// 分叉后需另调 [`Self::set_project`] 归属 —— 见 `commands::thread::fork_thread`。
    pub fn fork(
        app: &AppHandle,
        thread_id: &str,
        last_turn_id: Option<&str>,
        before_turn_id: Option<&str>,
        cwd: Option<&str>,
        config: Option<Value>,
    ) -> Result<String, String> {
        let mut params = json!({ "threadId": thread_id });
        if let Some(t) = last_turn_id {
            params["lastTurnId"] = json!(t);
        }
        if let Some(t) = before_turn_id {
            params["beforeTurnId"] = json!(t);
        }
        if let Some(c) = cwd {
            params["cwd"] = json!(c);
        }
        if let Some(cfg) = config {
            params["config"] = cfg;
        }
        let resp = Self::client(app)?.request("thread/fork", Some(params))?;
        resp.get("thread")
            .and_then(|t| t.get("id"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| format!("thread/fork 无 thread.id: {resp}"))
    }

    /// 触发上下文压缩(codex `thread/compact/start`)
    ///
    /// 三件事要知道(都是实测/读源码得来的,不是猜的):
    /// 1. 响应只表示**已受理** —— 压缩本身是一次完整模型调用,耗时以分钟计
    /// 2. `thread/compacted` 通知**对 v2 客户端不发**(源码里标为 deprecated,
    ///    「v2 clients receive the canonical ContextCompaction item instead」),
    ///    所以**没有完成信号**,只能靠轮询历史是否已被重写来判断
    /// 3. 压缩会把**整个会话历史重写成一条摘要消息**,旧轮次全部消失
    pub fn compact(app: &AppHandle, thread_id: &str) -> Result<(), String> {
        Self::client(app)?
            .request("thread/compact/start", Some(json!({ "threadId": thread_id })))
            .map(|_| ())
    }

    /// 把会话历史回退到某一轮**之前**(codex `thread/revert`)
    ///
    /// 三条要知道的(实测):
    /// 1. **只改持久化的对话历史,不撤销工作区文件改动** —— 与 Claude Code 的
    ///    rewind 不同,所以 UI 必须把这点讲清楚
    /// 2. **只支持 `paginated` 历史模式**的线程;legacy 线程会直接报
    ///    "thread/revert only supports paginated threads"
    /// 3. 是**同步**接口:响应即完成信号(不像压缩那样要轮询)
    pub fn revert(app: &AppHandle, thread_id: &str, before_turn_id: &str) -> Result<(), String> {
        Self::client(app)?
            .request(
                "thread/revert",
                Some(json!({ "threadId": thread_id, "beforeTurnId": before_turn_id })),
            )
            .map(|_| ())
    }

    /// 向**正在跑的那一轮**插话(codex `turn/steer`)
    ///
    /// `expected_turn_id` 必填,而且必须与当前活跃轮一致 —— 那是乐观并发保护,
    /// 传错会拿到 `expected active turn id ... but found ...`(实测)。
    /// 没有活跃轮时报 `no active turn to steer`;审查轮/压缩轮不可插话。
    ///
    /// 返回被插话的那一轮 id。
    pub fn steer(
        app: &AppHandle,
        thread_id: &str,
        expected_turn_id: &str,
        text: &str,
    ) -> Result<String, String> {
        let resp = Self::client(app)?.request(
            "turn/steer",
            Some(json!({
                "threadId": thread_id,
                "expectedTurnId": expected_turn_id,
                "input": [{ "type": "text", "text": text }],
            })),
        )?;
        resp.get("turnId")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| format!("turn/steer 无 turnId: {resp}"))
    }

    /// 文件名模糊搜索(codex `fuzzyFileSearch`)
    ///
    /// 比在客户端逐条 `includes` 强三点:模糊匹配、返回命中位置(可直接高亮)、
    /// 遵守忽略规则。`roots` 必须是**绝对路径**(实测传相对路径会被拒)。
    pub fn fuzzy_file_search(
        app: &AppHandle,
        query: &str,
        roots: &[String],
    ) -> Result<Vec<FuzzyFileHit>, String> {
        let resp = Self::client(app)?.request(
            "fuzzyFileSearch",
            Some(json!({ "query": query, "roots": roots })),
        )?;
        Ok(resp
            .get("files")
            .and_then(|f| f.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value::<FuzzyFileHit>(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default())
    }

    /// 把线程归入某个 codex project;传 `None` 表示清除归属
    pub fn set_project(
        app: &AppHandle,
        thread_id: &str,
        project_id: Option<&str>,
    ) -> Result<(), String> {
        Self::client(app)?
            .request(
                "thread/metadata/update",
                Some(json!({
                    "threadId": thread_id,
                    // 空串 = 清除(codex 的 StoreClearableField 约定)
                    "projectId": project_id.unwrap_or(""),
                })),
            )
            .map(|_| ())
    }

    // ── 搜索 ────────────────────────────────────────────────────

    /// 一级搜索:返回命中的线程 + 片段。**无 message_id/timestamp**,粒度是线程。
    pub fn search(
        app: &AppHandle,
        term: &str,
        archived: bool,
        limit: u32,
    ) -> Result<Vec<ThreadSearchHit>, String> {
        let resp = Self::client(app)?.request(
            "thread/search",
            Some(json!({
                "searchTerm": term,
                "sortKey": "updated_at",
                "sortDirection": "desc",
                "archived": archived,
                "limit": limit,
            })),
        )?;
        let hits = resp
            .get("data")
            .and_then(|d| d.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let thread = item.get("thread")?;
                        let row = ThreadRow::from_value(thread)?;
                        let title = row.display_title();
                        Some(ThreadSearchHit {
                            thread_id: row.id,
                            title,
                            project_id: row.project_id,
                            cwd: row.cwd,
                            updated_at: row.updated_at,
                            snippet: item
                                .get("snippet")
                                .and_then(|s| s.as_str())
                                .unwrap_or("")
                                .to_string(),
                            archived,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(hits)
    }

    /// 二级搜索:线程内每条命中,带 turn/item 用于精确定位跳转
    pub fn search_occurrences(
        app: &AppHandle,
        thread_id: &str,
        term: &str,
        limit: u32,
    ) -> Result<Vec<ThreadOccurrence>, String> {
        let resp = Self::client(app)?.request(
            "thread/searchOccurrences",
            Some(json!({
                "threadId": thread_id,
                "searchTerm": term,
                "limit": limit,
            })),
        )?;
        Ok(resp
            .get("data")
            .and_then(|d| d.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|o| {
                        Some(ThreadOccurrence {
                            turn_id: o.get("turnId")?.as_str()?.to_string(),
                            item_id: o.get("itemId")?.as_str()?.to_string(),
                            snippet: o
                                .get("snippet")
                                .and_then(|s| s.as_str())
                                .unwrap_or("")
                                .to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    // ── project ─────────────────────────────────────────────────

    pub fn project_list(app: &AppHandle) -> Result<Vec<CodexProject>, String> {
        let mut out = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let mut params = json!({ "limit": PAGE_LIMIT });
            if let Some(c) = cursor.as_deref() {
                params["cursor"] = json!(c);
            }
            let resp = Self::client(app)?.request("project/list", Some(params))?;
            if let Some(arr) = resp.get("data").and_then(|d| d.as_array()) {
                out.extend(arr.iter().filter_map(CodexProject::from_value));
            }
            match resp
                .get("nextCursor")
                .and_then(|c| c.as_str())
                .filter(|c| !c.is_empty())
            {
                Some(c) => cursor = Some(c.to_string()),
                None => break,
            }
        }
        Ok(out)
    }

    /// 建 project。
    ///
    /// `idempotency_key` 必须**一次性** —— codex 里若该 key 曾对应「已删除的项目」会直接
    /// 报 `InvalidRequest`,用固定 key 会让「删项目后重建同目录」永久失败。
    pub fn project_create(
        app: &AppHandle,
        name: &str,
        root: &str,
        flydex_project_id: &str,
        idempotency_key: &str,
    ) -> Result<CodexProject, String> {
        let resp = Self::client(app)?.request(
            "project/create",
            Some(json!({
                "name": name,
                "roots": [{ "path": root }],
                "metadata": { FLYDEX_PROJECT_META_KEY: flydex_project_id },
                "idempotencyKey": idempotency_key,
            })),
        )?;
        resp.get("project")
            .and_then(CodexProject::from_value)
            .ok_or_else(|| format!("project/create 无 project: {resp}"))
    }

    #[allow(dead_code)] // P5 接线
    pub fn project_update(
        app: &AppHandle,
        project_id: &str,
        name: Option<&str>,
        root: Option<&str>,
    ) -> Result<(), String> {
        let mut params = json!({ "projectId": project_id });
        if let Some(n) = name {
            params["name"] = json!(n);
        }
        if let Some(r) = root {
            params["roots"] = json!([{ "path": r }]);
        }
        Self::client(app)?
            .request("project/update", Some(params))
            .map(|_| ())
    }

    /// 只删 project,**不会删 thread**(codex 语义:仅把 thread.projectId 置空)。
    /// 要连带删会话必须由调用方先逐个 `thread/delete`。
    #[allow(dead_code)] // P5 接线
    pub fn project_delete(app: &AppHandle, project_id: &str) -> Result<(), String> {
        Self::client(app)?
            .request("project/delete", Some(json!({ "projectId": project_id })))
            .map(|_| ())
    }

    /// 列出**任意 project 之外**的线程(用于建 fork 图时跨项目查找后代)
    #[allow(dead_code)] // P5 接线
    pub fn list_all_unfiltered(app: &AppHandle, archived: bool) -> Result<Vec<ThreadRow>, String> {
        Self::list_all(app, archived, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真实抓取的 turn(见 `examples/probe_threads.rs` 的转储),字段名以此为准。
    #[test]
    fn normalize_turn_converts_items_and_timestamps() {
        let raw = json!({
            "id": "01a08940-bae7-7c51-8559-de42c66a72a5",
            "status": "failed",
            // 陷阱 G:codex 的 turn 时间戳是 Unix 秒
            "startedAt": 1789009115,
            "completedAt": 1789009163,
            "durationMs": 47687,
            "error": { "message": "high demand" },
            "items": [
                {
                    "id": "item-51",
                    "type": "userMessage",
                    "clientId": null,
                    "content": [{ "type": "text", "text": "hi", "textElements": [] }]
                },
                {
                    "id": "item-52",
                    "type": "commandExecution",
                    "command": "ls -la",
                    "status": "Completed",
                    "aggregatedOutput": "a
b",
                    "exitCode": 0,
                    "durationMs": 120,
                    "cwd": "C:/x"
                }
            ]
        });

        let t = normalize_turn(&raw);

        // 时间戳:秒 → 毫秒
        assert_eq!(t["startedAt"], json!(1789009115000i64));
        assert_eq!(t["completedAt"], json!(1789009163000i64));
        // 毫秒字段不能被再乘一次
        assert_eq!(t["durationMs"], json!(47687));
        // turn 自身其它字段原样保留
        assert_eq!(t["status"], json!("failed"));
        assert_eq!(t["error"]["message"], json!("high demand"));

        let items = t["items"].as_array().unwrap();
        // userMessage 的字段本就同名,只需确认没被破坏
        assert_eq!(items[0]["type"], json!("user_message"));
        assert_eq!(items[0]["id"], json!("item-51"));
        assert_eq!(items[0]["content"][0]["text"], json!("hi"));
        // commandExecution:驼峰字段翻成 snake_case,状态枚举翻成小写
        assert_eq!(items[1]["type"], json!("command_execution"));
        assert_eq!(items[1]["aggregated_output"], json!("a
b"));
        assert_eq!(items[1]["exit_code"], json!(0));
        assert_eq!(items[1]["duration_ms"], json!(120));
        assert_eq!(items[1]["status"], json!("completed"));
        assert_eq!(items[1]["cwd"], json!("C:/x"));
    }

    #[test]
    fn normalize_turn_is_idempotent_on_missing_fields() {
        // 字段缺失/为空时不能 panic(老版本 codex、中断的轮次)
        let t = normalize_turn(&json!({ "id": "t1", "status": "inProgress" }));
        assert_eq!(t["id"], json!("t1"));
        assert!(t.get("items").is_none());
    }
}
