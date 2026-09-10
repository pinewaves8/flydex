//! 线程与项目的级联删除
//!
//! codex 的 `thread/delete` 是**硬删除且不可逆**,而且**不会级联**。
//!
//! 关于「被 fork 引用的线程能不能删」:源头注释说会拒绝,但**实测(codex 0.149.1,
//! 见 `examples/probe_threads.rs --fork-probe`)是能删的** —— 删掉父线程后子线程
//! 会留下来,`forked_from_id` 指向一个已经不存在的线程,即**孤儿分支**。
//!
//! 所以这里的级联**不是协议要求,而是产品决定**:删一个会话就把它分叉出的分支
//! 一并删掉,不留孤儿。叶子优先的排序则保证中途失败时,已删的总是更深的节点,
//! 祖先链保持完整、可重试。
//!
//! 删项目时,只要有任一线程删不掉就**不删 project** —— 否则剩下的线程会变成
//! 「无归属孤儿」,比留着项目更难收拾。

use std::collections::{HashMap, HashSet};

use tauri::AppHandle;

use crate::services::thread_client::ThreadClient;

/// 一次删除的结果
#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CascadeOutcome {
    /// 实际删掉的线程(叶子优先的顺序)
    pub deleted: Vec<String>,
    /// 删不掉的线程与原因(**必须让用户看见**,第三原则)
    pub failures: Vec<String>,
}

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeleteOutcome {
    pub deleted_threads: usize,
    /// project 是否真的被删掉了(线程有失败时保持 false)
    pub project_deleted: bool,
    pub failures: Vec<String>,
}

/// 算出删除顺序:**叶子优先**(深度倒序)
///
/// codex 本身不级联也不拒绝(见模块头注释),所以这个顺序不是为了绕开约束,而是
/// 为了让「删到一半失败」留下可收拾的状态:已删的总是更深的节点,祖先链仍然完整。
///
/// `edges` 是 `(threadId, forkedFromId)` 全量列表;`roots` 是本次要删的起点。
/// 结果只包含**从 roots 可达**的节点 —— 不会顺手删掉无关线程。
///
/// 深度取「从 roots 出发的最长路径」而不是首次访问深度:一个节点可能有多条路径
/// 到达,只有最大深度才能保证它排在其所有父节点之后。
pub fn deletion_order(edges: &[(String, Option<String>)], roots: &[String]) -> Vec<String> {
    // 父 → 子
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    for (id, parent) in edges {
        if let Some(p) = parent.as_deref() {
            children.entry(p).or_default().push(id.as_str());
        }
    }

    let mut depth: HashMap<String, usize> = HashMap::new();
    // 上限:最长路径不会超过边数;同时兜住环(理论上不该有,但不能因此死循环)
    let cap = edges.len() + 1;
    let mut stack: Vec<(String, usize)> = roots.iter().map(|r| (r.clone(), 0)).collect();
    while let Some((id, d)) = stack.pop() {
        if d > cap {
            continue;
        }
        if depth.get(&id).is_some_and(|cur| *cur >= d) {
            continue;
        }
        depth.insert(id.clone(), d);
        if let Some(kids) = children.get(id.as_str()) {
            for k in kids {
                stack.push((k.to_string(), d + 1));
            }
        }
    }

    let mut ordered: Vec<(String, usize)> = depth.into_iter().collect();
    // 深的先删;同深度按 id 排序,让结果确定可测
    ordered.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    ordered.into_iter().map(|(id, _)| id).collect()
}


pub struct ThreadCascade;

impl ThreadCascade {
    /// 全量 fork 图
    ///
    /// **归档的线程也要拉**:归档的分支同样是真实存在的线程,漏掉就会在删父之后
    /// 变成孤儿。也**不加 project 过滤** —— fork 可以换工作目录/项目。
    fn fork_graph(app: &AppHandle) -> Result<Vec<(String, Option<String>)>, String> {
        let mut edges = Vec::new();
        let mut seen = HashSet::new();
        for archived in [false, true] {
            for t in ThreadClient::list_all_unfiltered(app, archived)? {
                if seen.insert(t.id.clone()) {
                    edges.push((t.id, t.forked_from_id));
                }
            }
        }
        Ok(edges)
    }

    /// 删除 `roots` 及其全部后代(叶子优先)
    ///
    /// 单个线程失败**不中断**其余删除 —— 尽量删干净,失败原因逐条回传。
    pub fn delete_threads(app: &AppHandle, roots: &[String]) -> Result<CascadeOutcome, String> {
        if roots.is_empty() {
            return Ok(CascadeOutcome::default());
        }
        let graph = Self::fork_graph(app)?;
        let order = deletion_order(&graph, roots);
        let mut out = CascadeOutcome::default();
        for id in order {
            match ThreadClient::delete(app, &id) {
                Ok(()) => out.deleted.push(id),
                Err(e) => out.failures.push(format!("{id}: {e}")),
            }
        }
        Ok(out)
    }

    /// 删除一个 codex project 及其名下的全部线程
    ///
    /// 线程有任何失败 → **不删 project**(见模块头注释的取舍)。
    pub fn delete_project(
        app: &AppHandle,
        codex_project_id: &str,
    ) -> Result<ProjectDeleteOutcome, String> {
        // 归档的线程也要删,否则它们会残留成无归属孤儿
        let mut roots = Vec::new();
        let mut seen = HashSet::new();
        for archived in [false, true] {
            for t in ThreadClient::list_all(app, archived, Some(codex_project_id))? {
                if seen.insert(t.id.clone()) {
                    roots.push(t.id);
                }
            }
        }

        let cascade = Self::delete_threads(app, &roots)?;
        if !cascade.failures.is_empty() {
            return Ok(ProjectDeleteOutcome {
                deleted_threads: cascade.deleted.len(),
                project_deleted: false,
                failures: cascade.failures,
            });
        }

        ThreadClient::project_delete(app, codex_project_id)?;
        Ok(ProjectDeleteOutcome {
            deleted_threads: cascade.deleted.len(),
            project_deleted: true,
            failures: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edges(pairs: &[(&str, Option<&str>)]) -> Vec<(String, Option<String>)> {
        pairs
            .iter()
            .map(|(id, p)| (id.to_string(), p.map(str::to_string)))
            .collect()
    }

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn deletes_children_before_parent() {
        // a ← b ← c( b 由 a fork,c 由 b fork);删 a 时顺序必须是 c、b、a
        let e = edges(&[("a", None), ("b", Some("a")), ("c", Some("b"))]);
        assert_eq!(deletion_order(&e, &s(&["a"])), s(&["c", "b", "a"]));
    }

    #[test]
    fn handles_multiple_children_deterministically() {
        let e = edges(&[("a", None), ("b", Some("a")), ("c", Some("a"))]);
        // 同深度按 id 排序 → 结果稳定可测
        assert_eq!(deletion_order(&e, &s(&["a"])), s(&["b", "c", "a"]));
    }

    #[test]
    fn only_walks_the_given_roots() {
        // 删 a 不应该碰到另一棵树的 x
        let e = edges(&[("a", None), ("b", Some("a")), ("x", None), ("y", Some("x"))]);
        let order = deletion_order(&e, &s(&["a"]));
        assert_eq!(order, s(&["b", "a"]));
        assert!(!order.contains(&"x".to_string()));
    }

    #[test]
    fn longest_path_wins_for_multi_parent_nodes() {
        // 菱形:d 由 b、c 共同 fork,而 b 又由 a fork。
        // 若用「首次访问深度」,d 可能拿到较浅的深度而排到 b 之前
        // → 先删了父,留下孤儿分支。
        let e = edges(&[
            ("a", None),
            ("b", Some("a")),
            ("c", Some("a")),
            ("d", Some("b")),
            ("d2", Some("c")),
        ]);
        let order = deletion_order(&e, &s(&["a"]));
        // d 必须排在 b 之前
        let pos = |x: &str| order.iter().position(|v| v == x).unwrap();
        assert!(pos("d") < pos("b"), "d 应在 b 之前: {order:?}");
        assert!(pos("d2") < pos("c"), "d2 应在 c 之前: {order:?}");
        assert_eq!(pos("a"), order.len() - 1, "根最后删: {order:?}");
    }

    #[test]
    fn cycle_does_not_hang() {
        // 理论上不该出现,但数据异常时也不能死循环
        let e = edges(&[("a", Some("b")), ("b", Some("a"))]);
        let order = deletion_order(&e, &s(&["a"]));
        assert!(order.contains(&"a".to_string()));
        assert!(order.contains(&"b".to_string()));
    }

    #[test]
    fn unknown_root_is_still_returned() {
        // 起点不在图里(比如列表里没有它)也要删掉它自己
        let e = edges(&[("a", None)]);
        assert_eq!(deletion_order(&e, &s(&["z"])), s(&["z"]));
    }

}
