"""P10 Rust 侧:接上 codex 的真压缩,删掉 Flydex 的假压缩。

旧的 `compact_summary` 调供应商 HTTP 生成一段摘要,把它作为**新消息**插进来,
原消息仍在 thread 里 —— 模型上下文一点没减少;而且它顺手把 threadId 置空,
原会话在 codex 侧变成孤儿。整段删除。
"""
import io
import re
import sys

# ── 1) ThreadClient 加 compress ──────────────────────────────
P = r'C:\llm\flydex\src-tauri\src\services\thread_client.rs'
s = io.open(P, encoding='utf-8').read()

anchor = '    /// 把线程归入某个 codex project;传 `None` 表示清除归属'
NEW = r'''    /// 触发上下文压缩(codex `thread/compact/start`)
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

    /// 把线程归入某个 codex project;传 `None` 表示清除归属'''
if anchor not in s:
    sys.exit('MISS ThreadClient anchor')
s = s.replace(anchor, NEW, 1)
io.open(P, 'w', encoding='utf-8').write(s)

# ── 2) 命令 ─────────────────────────────────────────────────
P = r'C:\llm\flydex\src-tauri\src\commands\thread.rs'
s = io.open(P, encoding='utf-8').read()
s = s.rstrip('\n') + r'''

/// 触发上下文压缩(codex `thread/compact/start`)
///
/// **会把会话历史重写成一条摘要消息、旧轮次消失**(codex 的压缩语义)。
/// 调用方必须先把这件事告诉用户。响应只表示已受理,完成需要轮询。
#[tauri::command]
pub fn compact_thread(app: AppHandle, thread_id: String) -> Result<(), String> {
    ThreadClient::compact(&app, &thread_id)
}
'''
io.open(P, 'w', encoding='utf-8').write(s)

# ── 3) 删掉假的 compact_summary 与其提示词 ──────────────────
P = r'C:\llm\flydex\src-tauri\src\commands\memory.rs'
s = io.open(P, encoding='utf-8').read()
m = re.search(r'\n/// 上下文压缩系统提示词[^\n]*\nconst COMPACT_SYSTEM: &str = r#".*?"#;\n', s, re.S)
if not m:
    sys.exit('MISS COMPACT_SYSTEM')
s = s[:m.start()] + '\n' + s[m.end():]
m2 = re.search(r'\n/// 把会话文本压缩成上下文快照摘要（调用当前配置的模型）.*?\n(?=/// |#\[tauri::command\]|\Z)', s, re.S)
if not m2:
    sys.exit('MISS compact_summary')
s = s[:m2.start()] + '\n' + s[m2.end():]
if 'compact_summary' in s or 'COMPACT_SYSTEM' in s:
    sys.exit('compact_summary 残留')
io.open(P, 'w', encoding='utf-8').write(s)

# ── 4) lib.rs 注册 ──────────────────────────────────────────
P = r'C:\llm\flydex\src-tauri\src\lib.rs'
s = io.open(P, encoding='utf-8').read()
s = s.replace('    compact_summary, extract_memory, load_memory,', '    extract_memory, load_memory,', 1)
s = re.sub(r'^ *compact_summary,\n', '', s, flags=re.M)
s = s.replace('    archive_thread,', '    archive_thread, compact_thread,', 1)
s = s.replace('            archive_thread,', '            archive_thread,\n            compact_thread,', 1)
io.open(P, 'w', encoding='utf-8').write(s)

print('ok')
