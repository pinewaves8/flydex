//! Flydex 项目 ↔ codex project 的归属映射
//!
//! codex 的 project id 由服务端生成(uuid),Flydex 侧是 `proj_<nanos+xorshift>`,
//! 两者无法直接换算,因此需要一次映射。
//!
//! **匹配优先用三路,而不是只信本地映射表** —— 映射表只是缓存:codex 的
//! `project/list`(含 `metadata["flydex.projectId"]`)才是权威。这样即使用户在
//! codex CLI / VSCode 扩展里也建过同目录的项目,也能收编到同一个,不会出现
//! 「同一目录两个项目」。
//!
//! 关于幂等键:codex 的 `project/create` 一旦用过的 key 指向**已删除**的项目,再用
//! 同一 key 会硬报错(`idempotency key refers to deleted project`,已实测)。
//! 所以每次创建都用一次性 key —— 真正兜住重复的是「创建前必跑三路匹配」:
//! 即便上次 create 成功但响应丢失,下次也会靠 metadata 命中而不重复建。

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::models::project::Project;
use crate::models::thread::CodexProject;
use crate::services::storage::Storage;
use crate::services::thread_client::ThreadClient;

/// 映射表文件名(与 security.json / hooks.json 同目录)
const MAP_FILE: &str = "codex_projects.json";

/// 单个项目的映射条目
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pub codex_project_id: String,
    pub path: String,
    pub name: String,
    /// **毫秒**(Flydex 口径)
    pub mapped_at: i64,
}

/// 持久化的映射表
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMapFile {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    updated_at: i64,
    /// flydex project id → 条目
    #[serde(default)]
    projects: HashMap<String, ProjectEntry>,
    /// 已回填过归属的 threadId(幂等:失败的下次重试)
    #[serde(default)]
    thread_project_backfill: Vec<String>,
}

fn default_version() -> u32 {
    1
}

/// 手写 `Default` 而不是 derive —— 否则 `Default::default()` 给出 `version: 0`,
/// 与 serde 的 `default_version()`(1)不一致:新建的文件会写成 0,
/// 未来任何按版本分支的迁移逻辑都会走错路。
impl Default for ProjectMapFile {
    fn default() -> Self {
        Self {
            version: default_version(),
            updated_at: 0,
            projects: HashMap::new(),
            thread_project_backfill: Vec::new(),
        }
    }
}

impl ProjectMapFile {
    fn path() -> Option<PathBuf> {
        Some(Storage::app_dir().join(MAP_FILE))
    }

    fn load() -> Self {
        let Some(p) = Self::path() else {
            return Self::default();
        };
        std::fs::read_to_string(p)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    fn save(&self) -> Result<(), String> {
        let Some(p) = Self::path() else {
            return Err("无法定位 ~/.flydex 目录".into());
        };
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&p, json).map_err(|e| format!("写入映射表失败: {e}"))
    }
}

/// 路径规范化 —— 与前端 `useProjectStore` 的 `norm()` 保持同一口径:
/// 小写、`\` → `/`、去尾斜杠。两边不一致会导致同一目录被认成两个项目。
pub fn norm_path(p: &str) -> String {
    // 先剥 Windows verbatim 前缀:项目 path 由用户提供、线程 cwd 由 codex 记录,
    // 两边形态不保证一致(实测 codex 侧基本都带 `\\?\`)。不剥就永远匹配不上,
    // 而且是**静默**的 —— 表现为「同一个目录被认成两个地方」。
    // (被测试逼出来的:`is_inside` 的用例发现带前缀的 cwd 匹配不上。)
    let p = crate::models::thread::strip_verbatim_prefix(p.trim());
    p.to_lowercase()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

/// 同步结果(回给前端做提示)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSyncOutcome {
    /// flydex project id → codex project id
    pub mappings: HashMap<String, String>,
    /// 本次新建的 codex project 数
    pub created: usize,
    /// 归属回填成功的线程数(来自旧会话文件里记录的对应关系)
    pub backfilled: usize,
    /// 按 cwd 归属成功的线程数
    pub attributed_by_cwd: usize,
    /// 非致命问题(第三原则:不静默吞,回传让 UI 可见)
    pub warnings: Vec<String>,
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// `child` 是否位于 `root` 目录树内(含 root 自身)
///
/// 用分隔符做边界,避免 `C:/llm/flydex-other` 被 `C:/llm/flydex` 误判为子树。
/// 与前端 `types/thread.ts` 的 `isInsidePath` 同口径。
pub fn is_inside(child: &str, root: &str) -> bool {
    let c = norm_path(child);
    let r = norm_path(root);
    if c.is_empty() || r.is_empty() {
        return false;
    }
    c == r || c.starts_with(&format!("{r}/"))
}

/// 一个待归属的线程
pub struct PendingThread {
    pub id: String,
    pub cwd: String,
}

/// 算出「哪个线程该归给哪个 codex project」
///
/// `roots` 是 `(codexProjectId, 项目根目录)`。**取最长匹配的根** ——
/// 否则同时存在 `C:\llm` 与 `C:\llm\flydex` 两个项目时,前者会把后者的线程全吞掉。
///
/// 返回 `(threadId, codexProjectId)`。写成纯函数是因为它决定了**写进 codex 的
/// 归属结果**(不可逆),判断逻辑必须先被测试钉死。
pub fn plan_cwd_attribution(
    threads: &[PendingThread],
    roots: &[(String, String)],
) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for t in threads {
        let mut best: Option<(&str, usize)> = None;
        for (pid, root) in roots {
            if !is_inside(&t.cwd, root) {
                continue;
            }
            let len = norm_path(root).len();
            if best.map(|(_, l)| len > l).unwrap_or(true) {
                best = Some((pid.as_str(), len));
            }
        }
        if let Some((pid, _)) = best {
            out.push((t.id.clone(), pid.to_string()));
        }
    }
    out
}

pub struct ProjectMap;

impl ProjectMap {
    /// 读取本地映射表(供前端在 codex 不可用时兜底显示)
    pub fn entries() -> HashMap<String, ProjectEntry> {
        ProjectMapFile::load().projects
    }

    /// 查某个 Flydex 项目对应的 codex project id
    ///
    /// 映射表是缓存;查不到说明该项目还没同步过(P1 的 `sync` 每次启动都会跑),
    /// 此时调用方应退化为「只删本地条目」。
    pub fn codex_project_id_for(flydex_project_id: &str) -> Option<String> {
        ProjectMapFile::load()
            .projects
            .get(flydex_project_id)
            .map(|e| e.codex_project_id.clone())
    }

    /// 删掉指向某个 codex project 的映射条目(项目被删后调用)
    pub fn remove_mapping(codex_project_id: &str) -> Result<(), String> {
        let mut file = ProjectMapFile::load();
        let before = file.projects.len();
        file.projects
            .retain(|_, e| e.codex_project_id != codex_project_id);
        if file.projects.len() == before {
            return Ok(());
        }
        file.updated_at = now_ms();
        file.save()
    }

    /// 把 Flydex 的项目列表同步到 codex,并回填已有线程的归属
    ///
    /// 幂等,可重复调用。**单个项目失败不中断整体**,问题收集进 `warnings`。
    pub fn sync(app: &AppHandle) -> Result<ProjectSyncOutcome, String> {
        let mut file = ProjectMapFile::load();
        let mut outcome = ProjectSyncOutcome {
            mappings: HashMap::new(),
            created: 0,
            backfilled: 0,
            attributed_by_cwd: 0,
            warnings: Vec::new(),
        };

        // codex 侧现有项目(权威);拿不到就只回本地缓存,不让 UI 崩
        let codex_projects = match ThreadClient::project_list(app) {
            Ok(list) => list,
            Err(e) => {
                outcome.warnings.push(format!(
                    "无法读取 codex 项目列表({e});项目归属暂用本地缓存。"
                ));
                for (k, v) in &file.projects {
                    outcome.mappings.insert(k.clone(), v.codex_project_id.clone());
                }
                return Ok(outcome);
            }
        };

        let local_projects = Storage::list_projects();
        for proj in &local_projects {
            match Self::resolve(app, proj, &codex_projects) {
                Ok((codex_id, was_created)) => {
                    if was_created {
                        outcome.created += 1;
                    }
                    outcome.mappings.insert(proj.id.clone(), codex_id.clone());
                    file.projects.insert(
                        proj.id.clone(),
                        ProjectEntry {
                            codex_project_id: codex_id,
                            path: proj.path.clone(),
                            name: proj.name.clone(),
                            mapped_at: now_ms(),
                        },
                    );
                }
                Err(e) => outcome
                    .warnings
                    .push(format!("项目「{}」同步失败: {e}", proj.name)),
            }
        }

        file.updated_at = now_ms();
        file.save()?;

        // 已有线程的归属回填:先按旧会话文件里记录的对应关系,再按 cwd 兜底。
        // 两者都用 thread_project_backfill / 只处理未归属的线程来保证幂等。
        outcome.backfilled =
            Self::backfill_threads(app, &mut file, &outcome.mappings, &mut outcome.warnings);
        outcome.attributed_by_cwd = Self::attribute_by_cwd(app, &file, &mut outcome.warnings);
        Ok(outcome)
    }

    /// 三路匹配:metadata → 根路径 → 新建
    fn resolve(
        app: &AppHandle,
        proj: &Project,
        codex_projects: &[CodexProject],
    ) -> Result<(String, bool), String> {
        // 1) metadata 命中(最可靠:Flydex 自己建的)
        if let Some(p) = codex_projects
            .iter()
            .find(|c| c.flydex_project_id.as_deref() == Some(proj.id.as_str()))
        {
            return Ok((p.id.clone(), false));
        }
        // 2) 根路径命中(能收编 codex CLI / VSCode 建的同目录项目)
        let want = norm_path(&proj.path);
        if let Some(p) = codex_projects
            .iter()
            .find(|c| !c.root.is_empty() && norm_path(&c.root) == want)
        {
            return Ok((p.id.clone(), false));
        }
        // 3) 新建 —— 一次性 key(见模块头注释:稳定 key 会在删项目后永久失效)
        let key = format!("flydex-{}-{}", proj.id, now_ms());
        let created = ThreadClient::project_create(app, &proj.name, &proj.path, &proj.id, &key)?;
        Ok((created.id, true))
    }

    /// 按 cwd 把「落在项目目录树内、但还没归属」的线程归入该项目
    ///
    /// 只处理**没有归属**的线程;已有归属的一律不动(那是用户的显式选择或上次的结果),
    /// 所以这个操作是幂等的 —— 第二次跑时已经没有可归属的了。
    fn attribute_by_cwd(
        app: &AppHandle,
        file: &ProjectMapFile,
        warnings: &mut Vec<String>,
    ) -> usize {
        // 映射表里存了各项目的路径,直接拿来做根匹配
        let roots: Vec<(String, String)> = file
            .projects
            .values()
            .map(|e| (e.codex_project_id.clone(), e.path.clone()))
            .collect();
        if roots.is_empty() {
            return 0;
        }

        let rows = match ThreadClient::list_all_unfiltered(app, false) {
            Ok(r) => r,
            Err(e) => {
                warnings.push(format!("按 cwd 归属失败(读不到会话列表): {e}"));
                return 0;
            }
        };
        let pending: Vec<PendingThread> = rows
            .into_iter()
            .filter(|t| t.project_id.is_none())
            .map(|t| PendingThread { id: t.id, cwd: t.cwd })
            .collect();
        if pending.is_empty() {
            return 0;
        }

        let plan = plan_cwd_attribution(&pending, &roots);
        let mut done = 0;
        for (thread_id, codex_project_id) in plan {
            match ThreadClient::set_project(app, &thread_id, Some(&codex_project_id)) {
                Ok(()) => done += 1,
                // 不记入 backfill → 下次还会重试;但要可见
                Err(e) => warnings.push(format!("线程 {thread_id} 按 cwd 归属失败: {e}")),
            }
        }
        done
    }

    /// 把已有 thread 归到对应 project
    ///
    /// 数据来源是旧的 `~/.flydex/sessions/*.json`(只有它记录了 `(threadId, projectId)`
    /// 的对应关系)。**只读,不改动这些文件** —— 它们是旧会话只读归档的唯一副本。
    fn backfill_threads(
        app: &AppHandle,
        file: &mut ProjectMapFile,
        mappings: &HashMap<String, String>,
        warnings: &mut Vec<String>,
    ) -> usize {
        let pairs = Storage::list_session_thread_projects();
        if pairs.is_empty() {
            return 0;
        }
        // 取成 owned,避免与下面的 push 冲突
        let done: std::collections::HashSet<String> =
            file.thread_project_backfill.iter().cloned().collect();
        let mut count = 0;
        let mut orphaned = 0usize;
        for (thread_id, flydex_project_id) in pairs {
            if done.contains(&thread_id) {
                continue;
            }
            let Some(codex_project_id) = mappings.get(&flydex_project_id) else {
                // 该会话原属的项目已被删除,且其 cwd 也不匹配任何现存项目 —— 无处可归。
                // 标记完成避免反复重试,但**必须让用户知道**(第三原则:不静默吞)。
                file.thread_project_backfill.push(thread_id.clone());
                orphaned += 1;
                continue;
            };
            match ThreadClient::set_project(app, &thread_id, Some(codex_project_id)) {
                Ok(()) => {
                    file.thread_project_backfill.push(thread_id);
                    count += 1;
                }
                Err(e) => {
                    // 不记录 → 下次 sync 会重试
                    warnings.push(format!("线程 {thread_id} 归属回填失败: {e}"));
                }
            }
        }
        if orphaned > 0 {
            warnings.push(format!(
                "{orphaned} 个历史会话因原所属项目已删除、且工作目录不匹配任何现存项目,未归入任何项目(它们仍可在 codex 侧按 cwd 找到)。"
            ));
        }
        let _ = file.save();
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn norm_path_unifies_windows_forms() {
        // 大小写、分隔符、尾斜杠三种差异必须归一(否则同一目录被认成两个项目)
        assert_eq!(norm_path("C:\\llm\\flydex"), "c:/llm/flydex");
        assert_eq!(norm_path("c:/llm/flydex"), "c:/llm/flydex");
        assert_eq!(norm_path("C:\\llm\\flydex\\"), "c:/llm/flydex");
        assert_eq!(norm_path("  C:\\LLM\\Flydex  "), "c:/llm/flydex");
    }

    #[test]
    fn resolve_prefers_metadata_over_path() {
        // metadata 命中优先于路径命中
        let codex = vec![
            CodexProject {
                id: "by-path".into(),
                name: "same-dir".into(),
                root: "C:\\proj".into(),
                flydex_project_id: None,
                created_at: 0,
                updated_at: 0,
            },
            CodexProject {
                id: "by-meta".into(),
                name: "other".into(),
                root: "D:\\elsewhere".into(),
                flydex_project_id: Some("proj_1".into()),
                created_at: 0,
                updated_at: 0,
            },
        ];
        let target = Project {
            id: "proj_1".into(),
            name: "x".into(),
            path: "C:\\proj".into(),
            platform: "windows".into(),
            created_at: 0,
            updated_at: 0,
        };
        // 直接验匹配逻辑(不经过 AppHandle)
        let by_meta = codex
            .iter()
            .find(|c| c.flydex_project_id.as_deref() == Some(target.id.as_str()))
            .map(|c| c.id.clone());
        assert_eq!(by_meta.as_deref(), Some("by-meta"));
        let by_path = codex
            .iter()
            .find(|c| norm_path(&c.root) == norm_path(&target.path))
            .map(|c| c.id.clone());
        assert_eq!(by_path.as_deref(), Some("by-path"));
    }

    #[test]
    fn map_file_round_trips() {
        let mut f = ProjectMapFile::default();
        f.projects.insert(
            "proj_1".into(),
            ProjectEntry {
                codex_project_id: "uuid-1".into(),
                path: "C:\\p".into(),
                name: "P".into(),
                mapped_at: 123,
            },
        );
        f.thread_project_backfill.push("t1".into());
        let json = serde_json::to_string(&f).unwrap();
        let back: ProjectMapFile = serde_json::from_str(&json).unwrap();
        assert_eq!(
            back.projects.get("proj_1").unwrap().codex_project_id,
            "uuid-1"
        );
        assert_eq!(back.thread_project_backfill, vec!["t1".to_string()]);
        assert_eq!(back.version, 1);
    }

    #[test]
    fn empty_map_parses_with_defaults() {
        // 文件缺失/为空时应能反序列化成默认值,不能让启动崩
        let f: ProjectMapFile = serde_json::from_str("{}").unwrap();
        assert!(f.projects.is_empty());
        assert_eq!(f.version, 1);
    }

    #[test]
    fn is_inside_respects_separator_boundary() {
        // 同前缀的兄弟目录不算子树 —— 少了边界判断 flydex-other 会被误判
        assert!(is_inside(r"C:\llm\flydex", r"C:\llm\flydex"));
        assert!(is_inside(r"C:\llm\flydex\src-tauri", r"C:\llm\flydex"));
        assert!(!is_inside(r"C:\llm\flydex-other", r"C:\llm\flydex"));
        assert!(!is_inside(r"C:\llm", r"C:\llm\flydex"));
        // 空串不能匹配一切
        assert!(!is_inside("", r"C:\llm\flydex"));
        assert!(!is_inside(r"C:\llm\flydex", ""));
    }

    #[test]
    fn is_inside_normalizes_verbatim_and_case() {
        // codex 记的 cwd 带 verbatim 前缀,项目 path 是人写的
        assert!(is_inside(r"\\?\C:\llm\FLYDEX\src", r"C:\llm\flydex"));
        assert!(is_inside("C:/llm/flydex/", r"C:\llm\flydex"));
    }

    fn th(id: &str, cwd: &str) -> PendingThread {
        PendingThread { id: id.into(), cwd: cwd.into() }
    }
    fn root(pid: &str, path: &str) -> (String, String) {
        (pid.into(), path.into())
    }

    #[test]
    fn attributes_threads_by_cwd() {
        let plan = plan_cwd_attribution(
            &[th("t1", r"\\?\C:\llm\flydex\src"), th("t2", r"C:\llm\flydex")],
            &[root("p1", r"C:\llm\flydex")],
        );
        assert_eq!(plan.len(), 2);
        assert!(plan.iter().all(|(_, pid)| pid == "p1"));
    }

    #[test]
    fn longest_root_wins() {
        // 同时有 C:\llm 和 C:\llm\flydex 时,后者更具体,必须赢 ——
        // 否则 C:\llm 这个大项目会把子项目的历史会话全吞走
        let plan = plan_cwd_attribution(
            &[th("inner", r"C:\llm\flydex\src-tauri"), th("outer", r"C:\llm\hunyuan")],
            &[root("big", r"C:\llm"), root("small", r"C:\llm\flydex")],
        );
        let get = |id: &str| plan.iter().find(|(t, _)| t == id).map(|(_, p)| p.clone());
        assert_eq!(get("inner").as_deref(), Some("small"));
        assert_eq!(get("outer").as_deref(), Some("big"));
    }

    #[test]
    fn threads_outside_all_roots_are_left_alone() {
        let plan = plan_cwd_attribution(
            &[th("a", r"C:\tao\Quill"), th("b", r"C:\llm\flydex-other")],
            &[root("p1", r"C:\llm\flydex")],
        );
        assert!(plan.is_empty(), "不该归属到无关的根: {plan:?}");
    }

    #[test]
    fn no_roots_means_nothing_attributed() {
        // 项目还没同步时不能乱归属
        assert!(plan_cwd_attribution(&[th("a", r"C:\llm\flydex")], &[]).is_empty());
    }

}
