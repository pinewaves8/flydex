import io

P = r'C:\llm\flydex\src-tauri\src\models\thread.rs'
s = io.open(P, encoding='utf-8').read()

helper = r'''
/// 去掉 Windows 的扩展长度前缀
///
/// codex 记录的 cwd 是 `\\?\C:\llm\flydex`(verbatim 形式),而 Flydex 项目的
/// path 是人写的 `C:\llm\flydex` —— 不归一就永远匹配不上,「同一目录」会被
/// 当成两个地方(实测线程列表里绝大多数 cwd 都是带前缀的形式)。
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

'''

anchor = '/// 会话列表行(来自 codex `thread/list`)'
assert anchor in s, 'MISS anchor'
s = s.replace(anchor, helper.lstrip('\n') + anchor, 1)

old_cwd = '''            cwd: v
                .get("cwd")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),'''
new_cwd = '''            cwd: strip_verbatim_prefix(v.get("cwd").and_then(|x| x.as_str()).unwrap_or("")),'''
assert old_cwd in s, 'MISS cwd'
s = s.replace(old_cwd, new_cwd, 1)

old_root = '''        let root = v
            .get("roots")
            .and_then(|r| r.as_array())
            .and_then(|a| a.first())
            .and_then(|r| r.get("path"))
            .and_then(|p| p.as_str())
            .unwrap_or("")
            .to_string();'''
new_root = '''        let root = strip_verbatim_prefix(
            v.get("roots")
                .and_then(|r| r.as_array())
                .and_then(|a| a.first())
                .and_then(|r| r.get("path"))
                .and_then(|p| p.as_str())
                .unwrap_or(""),
        );'''
assert old_root in s, 'MISS root'
s = s.replace(old_root, new_root, 1)

# 单测:放进已有的测试模块末尾
tests = r'''
    #[test]
    fn strip_verbatim_handles_windows_forms() {
        // 实测主线:codex 的 cwd 带 verbatim 前缀,项目 path 不带
        assert_eq!(strip_verbatim_prefix(r"\\?\C:\llm\flydex"), r"C:\llm\flydex");
        // 已归一的形式必须幂等(会被反复调用)
        assert_eq!(strip_verbatim_prefix(r"C:\llm\flydex"), r"C:\llm\flydex");
        // UNC:verbatim 的形式要还原成普通 UNC,而不是把 \\?\UNC\ 也删掉
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share"),
            r"\\server\share"
        );
        // 非 Windows 路径原样
        assert_eq!(strip_verbatim_prefix("/home/u/p"), "/home/u/p");
        assert_eq!(strip_verbatim_prefix(""), "");
    }
'''

# 找测试模块的最后一个 "}"(文件末尾)
idx = s.rfind('\n}')
assert idx > 0, 'MISS test module end'
s = s[:idx] + '\n' + tests + s[idx:]

io.open(P, 'w', encoding='utf-8').write(s)
print('ok')
