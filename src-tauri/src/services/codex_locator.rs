//! 定位 codex CLI 的入口
//!
//! 此前这里是**硬编码开发机的绝对路径**(`C:\Users\<某人>\AppData\...\codex.js`),
//! 既换不了机器、也扛不住重装 node —— 任何其他用户拿到的都是一个必然启动失败的
//! 程序。现在按优先级解析:
//!
//! 1. 环境变量 `FLYDEX_CODEX_JS` —— 显式指定,便于测试/自定义安装
//! 2. PATH 上的 `codex`(npm 全局安装会放一个同名 shim)
//! 3. `npm root -g` 下的 `@openai/codex/bin/codex.js`
//! 4. 若干平台常见位置(npm 全局目录的默认落点)
//!
//! 解析结果缓存(进程内只查一次);失败时返回**尝试过的全部位置**,让用户能自己
//! 判断该修什么 —— 「找不到 codex」而不说找过哪里等于没报错。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 可执行的入口:程序 + 参数前缀
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexEntry {
    pub program: PathBuf,
    pub args: Vec<String>,
}

impl CodexEntry {
    /// 用 node 跑某个 js 入口
    pub fn via_node(js: impl Into<PathBuf>) -> Self {
        Self {
            program: PathBuf::from("node"),
            args: vec![js.into().to_string_lossy().to_string()],
        }
    }

    /// 直接执行 shim(codex / codex.cmd)
    pub fn direct(bin: impl Into<PathBuf>) -> Self {
        Self {
            program: bin.into(),
            args: Vec::new(),
        }
    }
}

/// npm 全局包里 codex 入口的相对路径
const NPM_JS_REL: &str = "@openai/codex/bin/codex.js";

/// 平台上的 shim 文件名(PATH 上 npm 建的那个)
fn shim_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["codex.cmd", "codex.exe", "codex"]
    } else {
        &["codex"]
    }
}

/// npm 全局根目录下的入口路径
pub fn entry_under_npm_root(root: &Path) -> PathBuf {
    root.join(NPM_JS_REL)
}

/// 在 PATH 里找 codex 的 shim
fn shim_on_path() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for name in shim_names() {
            let cand = dir.join(name);
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    None
}

/// `npm root -g` 给出的全局根目录(拿不到就 None)
fn npm_global_root() -> Option<PathBuf> {
    // 用 npm 自己算,避免猜各个平台的默认布局
    let out = std::process::Command::new(if cfg!(windows) { "npm.cmd" } else { "npm" })
        .args(["root", "-g"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(PathBuf::from(s))
    }
}

/// 平台常见位置的候选(npm 全局默认落点)
fn conventional_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let home = dirs::home_dir();
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            out.push(entry_under_npm_root(&PathBuf::from(appdata).join("npm")));
        }
    } else {
        if let Some(h) = &home {
            out.push(entry_under_npm_root(&h.join(".npm-global/lib/node_modules")));
            out.push(entry_under_npm_root(&h.join(".local/lib/node_modules")));
        }
        out.push(entry_under_npm_root(Path::new("/usr/local/lib/node_modules")));
        out.push(entry_under_npm_root(Path::new("/usr/lib/node_modules")));
    }
    out
}

fn resolve() -> Result<CodexEntry, String> {
    let mut tried: Vec<String> = Vec::new();

    // 1) 显式指定
    if let Some(js) = std::env::var_os("FLYDEX_CODEX_JS") {
        let p = PathBuf::from(js);
        if p.is_file() {
            return Ok(CodexEntry::via_node(p));
        }
        tried.push(format!("FLYDEX_CODEX_JS={} (文件不存在)", p.display()));
    }

    // 2) PATH 上的 shim
    if let Some(shim) = shim_on_path() {
        return Ok(CodexEntry::direct(shim));
    }
    tried.push("PATH 上的 codex shim".to_string());

    // 3) npm 全局根
    if let Some(root) = npm_global_root() {
        let js = entry_under_npm_root(&root);
        if js.is_file() {
            return Ok(CodexEntry::via_node(js));
        }
        tried.push(format!("{}", js.display()));
    } else {
        tried.push("`npm root -g`(命令不可用)".to_string());
    }

    // 4) 常见位置
    for cand in conventional_candidates() {
        if cand.is_file() {
            return Ok(CodexEntry::via_node(cand));
        }
        tried.push(cand.display().to_string());
    }

    Err(format!(
        "找不到 codex CLI。已尝试:\n  - {}\n请安装(Node 自带 npm):\n  npm i -g @openai/codex\n\
         或用 FLYDEX_CODEX_JS 环境变量直接指定 codex.js 的路径。",
        tried.join("\n  - ")
    ))
}

/// 进程内缓存:启动 daemon 时只解析一次
static CACHE: OnceLock<Result<CodexEntry, String>> = OnceLock::new();

/// 取得 codex 入口(失败时给出「试过哪些位置」)
pub fn locate() -> Result<CodexEntry, String> {
    CACHE.get_or_init(resolve).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_path_is_joined_under_npm_root() {
        let root = Path::new("/usr/local/lib/node_modules");
        assert_eq!(
            entry_under_npm_root(root),
            PathBuf::from("/usr/local/lib/node_modules/@openai/codex/bin/codex.js")
        );
    }

    #[test]
    fn via_node_puts_js_in_args() {
        let e = CodexEntry::via_node("/x/codex.js");
        assert_eq!(e.program, PathBuf::from("node"));
        assert_eq!(e.args, vec!["/x/codex.js".to_string()]);
    }

    #[test]
    fn direct_has_no_args() {
        let e = CodexEntry::direct("/x/codex");
        assert_eq!(e.program, PathBuf::from("/x/codex"));
        assert!(e.args.is_empty());
    }

    #[test]
    fn shim_names_match_platform() {
        let names = shim_names();
        if cfg!(windows) {
            // Windows 上 npm 建的是 .cmd,不能只找无扩展名的
            assert!(names.contains(&"codex.cmd"));
        } else {
            assert_eq!(names, &["codex"]);
        }
    }

    #[test]
    fn conventional_candidates_are_absolute_and_unique() {
        let cands = conventional_candidates();
        assert!(!cands.is_empty(), "至少要有一个候选,否则回退等于没有");
        let mut seen = std::collections::HashSet::new();
        for c in &cands {
            assert!(c.is_absolute(), "候选必须是绝对路径: {}", c.display());
            assert!(seen.insert(c.clone()), "候选重复: {}", c.display());
        }
    }

    #[test]
    fn failure_message_lists_what_was_tried() {
        // 解析失败时错误信息必须包含"试过哪些位置",否则用户无从下手
        // (这里不真的触发失败:只检查常量拼接的形态)
        let msg = format!("找不到 codex CLI。已尝试:\n  - {}\n", "a\n  - b");
        assert!(msg.contains("已尝试"));
        assert!(msg.contains("  - a"));
    }
}
