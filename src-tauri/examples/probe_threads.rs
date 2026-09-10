//! 独立探针:直接对 `codex app-server` 说 JSON-RPC,验证迁移方案里几个高风险假设。
//!
//! **默认只读**;`--create-project` 会真的在用户的 codex state db 里建一个临时 project
//! (用于验证 idempotencyKey 语义),需要显式开启。
//!
//! 为什么要这个:`thread/turns/list` 的 `itemsView` 参数缺省行为、`project/create` 的幂等键
//! 语义,都只能对真 daemon 实测才能确认 —— 靠读代码推断很容易错(协议结构体的 Default
//! 与参数缺省并不一致)。探针不依赖 Tauri,单独跑就能把结论钉死。
//!
//! 用法:
//!   cd src-tauri && cargo run --example probe_threads
//!   cd src-tauri && cargo run --example probe_threads -- --create-project

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{json, Value};

const CODEX_JS: &str =
    r"C:\Users\peter woo\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js";

struct Probe {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: i64,
    stderr_lines: Vec<String>,
}

impl Probe {
    fn spawn() -> Result<Self, String> {
        let mut child = Command::new("node")
            .arg(CODEX_JS)
            .arg("app-server")
            .arg("--listen")
            .arg("stdio://")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动 app-server 失败: {e}"))?;
        let stdin = child.stdin.take().ok_or("无 stdin")?;
        let stdout = child.stdout.take().ok_or("无 stdout")?;
        let stderr = child.stderr.take().ok_or("无 stderr")?;
        // 必须持续读 stderr,否则管道填满会阻塞 daemon
        std::thread::spawn(move || {
            for l in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("[stderr] {}", l.chars().take(200).collect::<String>());
            }
        });
        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
            stderr_lines: Vec::new(),
        })
    }

    fn send(&mut self, msg: &Value) -> Result<(), String> {
        let line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        writeln!(self.stdin, "{line}").map_err(|e| format!("写 stdin 失败: {e}"))?;
        self.stdin.flush().map_err(|e| e.to_string())
    }

    /// 发送请求并等待同 id 的响应(忽略中间的通知/服务端请求)
    fn request(&mut self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let mut msg = json!({ "jsonrpc": "2.0", "id": id, "method": method });
        if let Some(p) = params {
            msg["params"] = p;
        }
        self.send(&msg)?;

        let mut line = String::new();
        loop {
            line.clear();
            let n = self
                .stdout
                .read_line(&mut line)
                .map_err(|e| format!("读 stdout 失败: {e}"))?;
            if n == 0 {
                return Err(format!("daemon 关闭(stdout EOF),等待 {method} 响应时"));
            }
            let Ok(v) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            // 服务端发来的请求:回一个空结果,避免 daemon 卡住
            if v.get("method").is_some() && v.get("id").is_some() {
                let sid = v.get("id").cloned().unwrap_or(Value::Null);
                let _ = self.send(&json!({ "jsonrpc": "2.0", "id": sid, "result": {} }));
                continue;
            }
            if v.get("id").and_then(|x| x.as_i64()) == Some(id) {
                if let Some(err) = v.get("error") {
                    return Err(format!("{method} 返回错误: {err}"));
                }
                return Ok(v.get("result").cloned().unwrap_or(Value::Null));
            }
        }
    }

    fn initialize(&mut self) -> Result<Value, String> {
        let r = self.request(
            "initialize",
            Some(json!({
                "clientInfo": { "name": "flydex-probe", "title": null, "version": "0" },
                // 迁移依赖大量 experimental 接口(project/*、thread/search*、turns/list)
                "capabilities": { "experimentalApi": true },
            })),
        )?;
        self.send(&json!({ "jsonrpc": "2.0", "method": "initialized" }))?;
        Ok(r)
    }
}

impl Drop for Probe {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn main() {
    let create_project = std::env::args().any(|a| a == "--create-project");
    // 原始 item JSON 转储:写映射逻辑时才需要,平时刷屏故默认关闭
    let dump_items = std::env::args().any(|a| a == "--dump-items");
    let mut failures: Vec<String> = Vec::new();

    let mut p = match Probe::spawn() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("FATAL: {e}");
            std::process::exit(1);
        }
    };

    println!("== 1. initialize(experimentalApi=true) ==");
    match p.initialize() {
        Ok(v) => println!(
            "OK  userAgent={}",
            v.get("userAgent").and_then(|u| u.as_str()).unwrap_or("-")
        ),
        Err(e) => {
            eprintln!("FAIL: {e}");
            std::process::exit(1);
        }
    }

    // ── 2. thread/list ──────────────────────────────────────────
    println!("\n== 2. thread/list(sortKey=updated_at, useStateDbOnly) ==");
    let list = p
        .request(
            "thread/list",
            Some(json!({
                "sortKey": "updated_at", "sortDirection": "desc",
                "limit": 100, "archived": false, "useStateDbOnly": true,
            })),
        )
        .expect("thread/list 应成功");
    let mut rows = list.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
    println!("OK  第 1 页 {} 条", rows.len());
    // 翻页拿真实总数(之前只取一页导致误判)
    let mut cursor = list.get("nextCursor").and_then(|c| c.as_str()).map(str::to_string);
    let mut pages = 1;
    while let Some(cur) = cursor.clone() {
        if pages >= 10 { break }
        let next = p.request("thread/list", Some(json!({
            "sortKey": "updated_at", "sortDirection": "desc",
            "limit": 100, "archived": false, "useStateDbOnly": true, "cursor": cur,
        }))).expect("翻页应成功");
        let batch = next.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
        rows.extend(batch);
        pages += 1;
        cursor = next.get("nextCursor").and_then(|c| c.as_str()).map(str::to_string);
    }
    println!("    翻 {pages} 页后共 {} 条", rows.len());
    if let Some(first) = rows.first() {
        println!(
            "    样例: id={} preview={:?} projectId={:?} cwd={:?}",
            first.get("id").and_then(|v| v.as_str()).unwrap_or("-"),
            first.get("preview").and_then(|v| v.as_str()).unwrap_or(""),
            first.get("projectId").and_then(|v| v.as_str()),
            first.get("cwd").and_then(|v| v.as_str()).unwrap_or(""),
        );
        // 时间戳单位验证(陷阱 G:秒 vs 毫秒)
        if let Some(ts) = first.get("updatedAt").and_then(|v| v.as_i64()) {
            let unit = if ts > 10_000_000_000 { "毫秒" } else { "秒" };
            println!("    updatedAt={ts} → 判定为 {unit} (陷阱 G 预期:秒)");
            if unit != "秒" {
                failures.push("updatedAt 不是秒级,时间换算假设错误".into());
            }
        }
    }
    // Flydex 自己的线程是否在默认列表里(陷阱 B)
    let flydex_owned = rows
        .iter()
        .filter(|r| r.get("modelProvider").and_then(|v| v.as_str()).unwrap_or("").starts_with("flydex_"))
        .count();
    println!("    其中 provider 以 flydex_ 开头(即 Flydex 创建的线程): {flydex_owned} 条");

    // ── 2a. 回收站面板依赖的 archived 列表 ──
    println!("
== 2a. thread/list archived=true(回收站面板的数据源) ==");
    match p.request(
        "thread/list",
        Some(json!({
            "sortKey": "updated_at", "sortDirection": "desc",
            "limit": 100, "archived": true, "useStateDbOnly": true,
        })),
    ) {
        Ok(v) => {
            let n = v.get("data").and_then(|d| d.as_array()).map(|a| a.len()).unwrap_or(0);
            println!("OK  归档的线程 {n} 条");
        }
        Err(e) => {
            println!("FAIL(回收站面板会空): {e}");
            failures.push(format!("archived 列表不可用: {e}"));
        }
    }

    // ── 2b. thread/list 带 projectId 过滤(实验性参数,可能是双 Option) ──
    println!("
== 2b. thread/list 的 projectId 过滤 ==");
    if let Ok(pv) = p.request("project/list", Some(json!({ "limit": 100 }))) {
        if let Some(first) = pv.get("data").and_then(|d| d.as_array()).and_then(|a| a.first()) {
            let pid = first.get("id").and_then(|v| v.as_str()).unwrap_or("");
            match p.request("thread/list", Some(json!({
                "sortKey": "updated_at", "sortDirection": "desc",
                "limit": 100, "archived": false, "useStateDbOnly": true,
                "projectId": pid,
            }))) {
                Ok(v) => {
                    let n = v.get("data").and_then(|d| d.as_array()).map(|a| a.len()).unwrap_or(0);
                    println!("OK  projectId={pid} → {n} 条");
                    println!("    (不带过滤时是 {} 条)", rows.len());
                    if n == 0 {
                        println!("    ⚠ 过滤返回 0 —— 要么该项目确实没有线程,要么参数名/形态不对");
                    }
                }
                Err(e) => println!("FAIL(说明该参数用法有问题): {e}"),
            }
        }
    }

    // ── 3. project/list ─────────────────────────────────────────
    println!("\n== 3. project/list ==");
    match p.request("project/list", Some(json!({ "limit": 100 }))) {
        Ok(v) => {
            let arr = v.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
            println!("OK  返回 {} 个 project", arr.len());
            for pr in arr.iter().take(5) {
                println!(
                    "    name={:?} root={:?} metadata={:?}",
                    pr.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                    pr.get("roots").and_then(|r| r.as_array()).and_then(|a| a.first())
                        .and_then(|r| r.get("path")).and_then(|v| v.as_str()).unwrap_or(""),
                    pr.get("metadata")
                );
            }
        }
        Err(e) => {
            println!("FAIL(不影响 P0,但 P1 要降级处理): {e}");
            failures.push(format!("project/list 不可用: {e}"));
        }
    }

    // ── 4. 陷阱 A:turns/list 的 itemsView 缺省行为 ─────────────
    //
    // 注意:必须挑「轮内 item 数 > 1」的线程才有区分度 —— 每轮只有 1 个 item 时
    // 两种模式的 item 总数相同,测了等于没测(第一版就踩了这个坑)。
    println!("
== 4. 【关键】thread/turns/list 的 itemsView 缺省 vs full ==");

    let count = |v: &Value| -> (usize, usize, usize) {
        let turns = v.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
        let items: usize = turns
            .iter()
            .map(|t| t.get("items").and_then(|i| i.as_array()).map(|a| a.len()).unwrap_or(0))
            .sum();
        let max_per_turn = turns
            .iter()
            .map(|t| t.get("items").and_then(|i| i.as_array()).map(|a| a.len()).unwrap_or(0))
            .max()
            .unwrap_or(0);
        (turns.len(), items, max_per_turn)
    };

    // 挑一个「轮内 item 最多」的线程(最多试 8 个候选)
    let mut probe_thread: Option<String> = None;
    for r in rows.iter().take(8) {
        let Some(id) = r.get("id").and_then(|v| v.as_str()) else { continue };
        let Ok(resp) = p.request(
            "thread/turns/list",
            Some(json!({ "threadId": id, "limit": 20, "itemsView": "full" })),
        ) else { continue };
        let (_t, _i, max_items) = count(&resp);
        if max_items > 1 {
            println!("    选中线程 {id}(单轮最多 {max_items} 个 item)");
            probe_thread = Some(id.to_string());
            break;
        }
    }

    match probe_thread {
        None => println!(
            "    ⚠ 前 8 个线程每轮都只有 1 个 item,无法区分 —— 请在一个有工具调用的会话上重跑"
        ),
        Some(tid) => {
            let default_resp = p
                .request("thread/turns/list", Some(json!({ "threadId": tid, "limit": 20 })))
                .expect("缺省参数应成功");
            let (t1, i1, m1) = count(&default_resp);
            println!("    缺省(不传 itemsView): {t1} 轮 / {i1} 个 item / 单轮最多 {m1}");

            let full_resp = p
                .request(
                    "thread/turns/list",
                    Some(json!({ "threadId": tid, "limit": 20, "itemsView": "full" })),
                )
                .expect("itemsView=full 应成功");
            let (t2, i2, m2) = count(&full_resp);
            println!("    itemsView=full:       {t2} 轮 / {i2} 个 item / 单轮最多 {m2}");

            if i2 > i1 {
                println!("    ✔ 陷阱 A 确认成立:必须显式传 itemsView=\"full\",否则丢 {}({i2}→{i1}) 个 item", i2 - i1);
            } else {
                println!("    ✔ 陷阱 A 不成立:缺省行为已是 full(可省略该参数)");
            }
            // 打印首轮实际 item 类型,便于核对映射表覆盖面
            if let Some(turn) = full_resp.get("data").and_then(|d| d.as_array()).and_then(|a| a.first()) {
                let types: Vec<String> = turn
                    .get("items").and_then(|i| i.as_array()).map(|a| {
                        a.iter().filter_map(|it| it.get("type").and_then(|t| t.as_str()).map(str::to_string)).collect()
                    }).unwrap_or_default();
                println!("    首轮 item 类型: {types:?}");
                // 原始 JSON 转储 —— 写映射逻辑前先看真实字段名,别靠读源码猜
                if dump_items {
                if let Some(items) = turn.get("items").and_then(|i| i.as_array()) {
                    for it in items {
                        let t = it.get("type").and_then(|v| v.as_str()).unwrap_or("?");
                        println!(
                            "    --- item[{t}] ---
{}",
                            serde_json::to_string_pretty(it).unwrap_or_default()
                        );
                    }
                }
                println!(
                    "    --- turn 自身字段 ---
{}",
                    serde_json::to_string_pretty(
                        &serde_json::Value::Object(
                            turn.as_object()
                                .map(|o| o.iter().filter(|(k, _)| k.as_str() != "items")
                                    .map(|(k, v)| (k.clone(), v.clone())).collect()
                                ).unwrap_or_default()
                        )
                    ).unwrap_or_default()
                );
                }
            }
        }
    }

    // ── 5. thread/search(experimental 门控验证) ─────────────────
    println!("
== 5. thread/search(experimental) ==");
    match p.request("thread/search", Some(json!({ "searchTerm": "flydex", "limit": 5 }))) {
        Ok(v) => {
            let n = v.get("data").and_then(|d| d.as_array()).map(|a| a.len()).unwrap_or(0);
            println!("OK  命中 {n} 条线程(粒度=线程,非消息)");
        }
        Err(e) => println!("FAIL: {e}"),
    }

    // ── 6. 陷阱 D:idempotencyKey 指向已删除项目会怎样 ───────────
    //
    // 这决定 P1 能否用「Flydex proj_id」当稳定幂等键。若能,映射逻辑可以极简;
    // 若不能,每次新建都必须用一次性 key。
    if create_project {
        println!("
== 6. 陷阱 D:project/create 幂等键语义(会写用户 codex 状态,自动清理) ==");
        let key = format!("flydex-probe-{}", std::process::id());
        let dir_a = std::env::temp_dir().join(format!("flydex-probe-a-{}", std::process::id()));
        let dir_b = std::env::temp_dir().join(format!("flydex-probe-b-{}", std::process::id()));
        std::fs::create_dir_all(&dir_a).ok();
        std::fs::create_dir_all(&dir_b).ok();

        macro_rules! create {
            ($root:expr) => {
                p.request(
                    "project/create",
                    Some(json!({
                        "name": "flydex-probe",
                        "roots": [{ "path": $root.to_string_lossy() }],
                        "metadata": { "flydex.projectId": "probe" },
                        "idempotencyKey": key,
                    })),
                )
            };
        }

        let mut created_id: Option<String> = None;
        match create!(&dir_a) {
            Ok(v) => {
                let id = v
                    .get("project")
                    .and_then(|x| x.get("id"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                println!("    [1] 首次创建        → id={id} created={:?}", v.get("created"));
                created_id = Some(id);
            }
            Err(e) => failures.push(format!("首次创建失败: {e}")),
        }
        match create!(&dir_a) {
            Ok(v) => {
                let id = v
                    .get("project")
                    .and_then(|x| x.get("id"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                println!("    [2] 同 key 重放      → id={id} created={:?}", v.get("created"));
                if Some(id.to_string()) != created_id {
                    failures.push("同 key 重放返回了不同 project(幂等失效)".into());
                }
            }
            Err(e) => failures.push(format!("同 key 重放失败: {e}")),
        }
        if let Some(id) = created_id.clone() {
            match p.request("project/delete", Some(json!({ "projectId": id }))) {
                Ok(_) => println!("    [3] 已删除该 project"),
                Err(e) => failures.push(format!("删除失败: {e}")),
            }
            match create!(&dir_b) {
                Ok(v) => {
                    let id2 = v
                        .get("project")
                        .and_then(|x| x.get("id"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string();
                    println!("    [4] 删除后同 key 重建 → id={id2} created={:?}", v.get("created"));
                    println!("        ⇒ 陷阱 D 不成立:稳定 key 可复用,映射逻辑能简化");
                    let _ = p.request("project/delete", Some(json!({ "projectId": id2 })));
                }
                Err(e) => {
                    println!("    [4] 删除后同 key 重建 → 失败: {e}");
                    println!("        ⇒ 陷阱 D 成立:必须用一次性 key(与方案一致)");
                }
            }
        }
    } else {
        println!("
(跳过 project/create 与陷阱 D 测试;加 --create-project 验证)");
    }

    // ── 7. --set-project <threadId> <projectId>:验证归属写入是否持久 ──
    let args: Vec<String> = std::env::args().collect();
    if let Some(pos) = args.iter().position(|a| a == "--set-project") {
        let tid = args.get(pos + 1).cloned().unwrap_or_default();
        let pid = args.get(pos + 2).cloned().unwrap_or_default();
        println!("
== 7. thread/metadata/update 归属 ==");
        match p.request(
            "thread/metadata/update",
            Some(json!({ "threadId": tid, "projectId": pid })),
        ) {
            Ok(v) => println!("    写入 OK: {v}"),
            Err(e) => {
                println!("    写入 FAIL: {e}");
                failures.push(format!("metadata/update 失败: {e}"));
            }
        }
        match p.request("thread/read", Some(json!({ "threadId": tid, "includeTurns": false }))) {
            Ok(v) => println!(
                "    回读 projectId = {:?}",
                v.get("thread").and_then(|t| t.get("projectId"))
            ),
            Err(e) => println!("    回读 FAIL: {e}"),
        }
    }


    // ── 8. --delete-thread <threadId>:清理测试会话(硬删除,不可逆) ──
    if let Some(pos) = args.iter().position(|a| a == "--delete-thread") {
        let tid = args.get(pos + 1).cloned().unwrap_or_default();
        match p.request("thread/delete", Some(json!({ "threadId": tid }))) {
            Ok(_) => println!("已删除 {tid}"),
            Err(e) => println!("删除 {tid} 失败: {e}"),
        }
    }


    // ── 9. --fork-probe:验证级联删除的前提 ──
    //
    // 自建线程 → fork 出子线程 → 按「子先父后」删除,**全程不碰任何已有线程**。
    // 为什么必须自建:待验证的正是"codex 会不会拒绝删被引用的父线程",而这一步本身就是
    // 不可逆的 —— 拿别人的会话去赌这个前提,一旦不成立就是数据损失。
    if args.iter().any(|a| a == "--fork-probe") {
        println!("\n== 9. 级联删除的前提(fork 引用 / 删除顺序) ==");
        let probe_root =
            std::env::temp_dir().join(format!("flydex-fork-probe-{}", std::process::id()));
        std::fs::create_dir_all(&probe_root).ok();

        let parent = p
            .request(
                "thread/start",
                Some(json!({ "cwd": probe_root.to_string_lossy(), "ephemeral": false })),
            )
            .and_then(|v| {
                v.get("thread")
                    .and_then(|t| t.get("id"))
                    .and_then(|i| i.as_str())
                    .map(str::to_string)
                    .ok_or_else(|| "thread/start 无 thread.id".to_string())
            });

        match parent {
            Err(e) => failures.push(format!("无法建探针线程: {e}")),
            Ok(parent_id) => {
                println!("    自建父线程 {}", &parent_id[..8.min(parent_id.len())]);
                // 跑一小轮:fork 需要一个已完成的分叉点
                let _ = p.request(
                    "turn/start",
                    Some(json!({
                        "threadId": parent_id,
                        "input": [{ "type": "text", "text": "reply with the single word: ok" }],
                    })),
                );
                // 等本轮结束(未结束的轮次不能被 fork 引用)
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
                let mut last_turn: Option<String> = None;
                while std::time::Instant::now() < deadline {
                    if let Ok(v) = p.request(
                        "thread/turns/list",
                        Some(json!({ "threadId": parent_id, "limit": 5, "itemsView": "full" })),
                    ) {
                        last_turn = v
                            .get("data")
                            .and_then(|d| d.as_array())
                            .and_then(|a| {
                                a.iter().find(|t| {
                                    t.get("status").and_then(|s| s.as_str()) != Some("inProgress")
                                })
                            })
                            .and_then(|t| t.get("id"))
                            .and_then(|v| v.as_str())
                            .map(str::to_string);
                        if last_turn.is_some() {
                            break;
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }

                match last_turn {
                    None => println!("    ⚠ 本轮未在超时内完成,跳过 fork 测试"),
                    Some(ltt) => {
                        let child = p
                            .request(
                                "thread/fork",
                                Some(json!({ "threadId": parent_id, "lastTurnId": ltt })),
                            )
                            .and_then(|v| {
                                v.get("thread")
                                    .and_then(|t| t.get("id"))
                                    .and_then(|i| i.as_str())
                                    .map(str::to_string)
                                    .ok_or_else(|| "fork 无 thread.id".to_string())
                            });
                        match child {
                            Err(e) => println!("    fork 失败: {e}"),
                            Ok(child_id) => {
                                println!("    fork 出子线程 {}", &child_id[..8.min(child_id.len())]);

                                // (1) 有子线程时删父 → 预期被拒
                                match p
                                    .request("thread/delete", Some(json!({ "threadId": parent_id })))
                                {
                                    Err(e) => {
                                        let m: String = e.chars().take(140).collect();
                                        println!("    [1] 有分支时删父 → 被拒绝 ✔(级联排序因此必需)");
                                        println!("        {m}");
                                    }
                                    Ok(_) => {
                                        // 这是**已知结论**而非缺陷:codex 0.149.1 不拒绝。
                                        // 记在这里是为了下次有人重读源码时别再把注释当真。
                                        println!("    [1] 有分支时删父 → 成功(与源码注释相反)");
                                        println!("        ⇒ 级联不是协议要求,而是产品决定:不删子就会留孤儿");
                                    }
                                }

                                // (2) 先删子
                                match p
                                    .request("thread/delete", Some(json!({ "threadId": child_id })))
                                {
                                    Ok(_) => println!("    [2] 先删子 → 成功 ✔"),
                                    Err(e) => failures.push(format!("删子失败: {e}")),
                                }
                                // (3) 再删父(此时已无引用)
                                match p
                                    .request("thread/delete", Some(json!({ "threadId": parent_id })))
                                {
                                    Ok(_) => println!("    [3] 再删父 → 成功 ✔(叶子优先的顺序可行)"),
                                    Err(e) => failures.push(format!("删父失败: {e}")),
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    println!("\n================ 结论 ================");
    if failures.is_empty() {
        println!("全部假设验证通过");
    } else {
        for f in &failures {
            println!("✗ {f}");
        }
        std::process::exit(1);
    }
}
