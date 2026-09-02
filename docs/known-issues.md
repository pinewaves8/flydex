# Flydex 已知问题与待办

## 未完成 Bug

### 1. Codex 文件写入/Sandbox 模式支持（✅ 已在任务 3.10 解决）

**状态**：已解决（2026-09-02，任务 3.10 技术债清理）

**历史问题描述**（早期记录，均已过时）：
- ~~codex CLI 默认运行在 `read-only` sandbox 模式，无法创建/修改文件~~
- ~~尝试 `--sandbox workspace-write`：命令阻塞等待审批交互（stdin），因我们使用 `Stdio::null()` 导致死锁~~
- ~~尝试 `--approve-for-me`：应用闪退（原因待查）~~
- ~~`--sandbox` 与 `--approve-for-me` 不能同时使用（CLI 参数冲突）~~

**真实根因（源码级核实）**：exec 模式不支持交互式审批——codex `exec/src/lib.rs` 对 `CommandExecutionRequestApproval` / `FileChangeRequestApproval` 一律直接 reject（"not supported in exec mode"）。flydex 此前把 `approval_policy=on-request` 透传给 exec → AI 写文件/执行命令时操作被 codex 直接拒绝，表现为"无法写文件"。与 stdin 死锁无关。

**当前实现（3.x + 3.10）**：
- 已用 portable-pty 取代 `Stdio::null()`（`native_pty_system`），非死锁
- 沙箱模式由 `~/.flydex/security.json` 用户配置控制，经 `-c sandbox_mode=...` 传入；默认 danger-full-access
- **exec/resume 普通对话强制 `approval_policy=never`**（3.10）：headless 无法交互审批，on-request 只会让操作被拒；写操作放行与否完全由 sandbox_mode 决定
- Plan/Review 模式强制 read-only 沙箱

**遗留**：前端 approval_request 审批卡为 dead code（保留为 codex 未来支持 exec 审批的兼容点）；审批历史在 exec 模式下无真实触发点。

---

### 2. Codex 全缓冲/流式输出问题

**状态**：未解决，当前可接受

**问题描述**：
- codex 在非 TTY 环境下 stdout 全缓冲，输出攒到进程结束才刷新
- 当前通过 `try_wait` 轮询 + 读取线程能获取完整输出，但不是真正的流式
- 长回复场景下用户需要等待整个进程结束才能看到输出

**解决方案（待实现）**：
- 引入 PTY（伪终端）模拟 TTY 环境，强制 codex 行缓冲输出
- Windows 上可用 `conpty`，macOS 上可用 `pty` crate

**预计实现阶段**：阶段 3（功能模块扩展）

---

## 已修复 Bug 记录

### 任务 1.1 修复的 5 个 Bug

1. **setStatus 函数式更新导致白屏**：zustand store 的 setStatus 只接受值，不接受函数，误传 `(prev) => ...` 导致 status 变成函数对象，`STATUS_CONFIG[status]` 返回 undefined 读取 `.color` 崩溃
2. **useEffect 依赖链导致事件监听器异常**：React StrictMode 下 useEffect 执行两次，异步 listen 完成前清理函数被调用，导致第一个监听器泄漏，事件被处理两次（输出重复）
3. **ChatPanel 未解构 output 变量**：ReferenceError: output is not defined
4. **serde rename_all 不匹配带点号的 type 值**：`rename_all = "snake_case"` 把 `ThreadStarted` 变成 `thread_started`，但实际 JSON 是 `thread.started`（带点号），导致 JSONL 解析失败
5. **CodexEvent::Json 字段名与 content="data" 冲突导致双层嵌套**：`Json { data: Value }` 的字段名 data 与 serde 的 `content = "data"` 冲突，序列化后变成 `{type:"Json", data:{data:{...}}}`，前端取 payload.data 拿到的是 `{data:{...}}` 而不是原始 JSON

### 任务 1.2 修复的 Bug

6. **代码块输出 [object Object]**：rehype-highlight 把代码块内容转换成带 `<span>` 的 React 元素数组，`String(children)` 把对象转成 `[object Object]`。修复：新增 `extractText()` 递归提取纯文本（用于复制），CodeBlock 直接渲染 `{children}` 保留高亮

---

## 环境已知问题

### pnpm 11 ERR_PNPM_IGNORED_BUILDS
- pnpm 11 默认阻止未批准的构建脚本（esbuild 等）
- 导致所有 `pnpm <script>` 命令失败
- 绕过方式：直接用 `node node_modules/<package>/bin/<entry>.js` 调用
- tauri 启动：`node node_modules\@tauri-apps\cli\tauri.js dev`

### Node 版本切换
- 系统安装 Node v24.19.0 在 `C:\Program Files\nodejs`
- Doubao sandbox 自带 Node v20 在 PATH 前面
- 运行 pnpm/npm 前需执行：`$env:Path = "C:\Program Files\nodejs;" + $env:Path`

### Windows codex 启动
- npm 全局安装的是 `codex.cmd`，Rust `Command::new("codex")` 不会自动补扩展名
- 解决方案：Windows 上用 `cmd /c codex exec` 启动
