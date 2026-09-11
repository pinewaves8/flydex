# Flydex 已知问题与待办

> 本文只记**仍未处理**的问题与环境坑。
> harness 能力清单、codex 侧实测陷阱见 `AGENTS.md`（§2.4 收敛进度 / §2.5 实测陷阱 / §10 数据位置）。
> 已解决的问题挪到文末「历史存档」，仅作记录，描述可能已过时。

---

## 一、仍待处理

### 1. 代码审查未走 codex 原生 `review/start`

**状态**：未评估（有意搁置）

Flydex 现在用自己的 `git_review_diff` 拼 diff，再由"审查模式"提示模型输出结构化报告。
codex 有原生 `review/start`。

**为什么没换**：同一轮评估里，`model/list`、`skills/list`、`hooks/list` 三个候选
**表面上都是"接口存在、语义应该相同"，实测后全部因语义不符而不可替换**（原因见 AGENTS.md §2.4）。
在没有确认 `review/start` 的返回/交互语义之前，不再贸然推进 —— 需要时用探针先打真 daemon 验证。

### 2. 文件变更卡片仍靠 git 反推

`turn/diff/updated` 已经转发到前端，但 UI 生成文件变更卡片的路径仍是
`git_status_changes` 前后快照比对。好处是能覆盖"模型用 shell here-string 写文件"
这种没有 `fileChange` item 的情况；代价是多一次 git 调用且可能漏掉非 git 目录。

### 3. 上下文压缩需要手动触发

codex 支持自动压缩，Flydex 目前只在用户 `/compact` 或上下文超 80% 时手动触发。

### 4. 旧会话（只读归档）不可迁移

`~/.flydex/sessions/*.json` 里没有 `threadId` 的老会话（约 4 条）**无法迁移**：
它们只落了 AI 侧内容、从未保存用户提问，重建成对话会得到畸形上下文。
因此仅作只读展示，且**删项目时不得删除这些文件**（它们是唯一副本）。

---

## 二、环境坑

### pnpm 11 默认阻止未批准的构建脚本

若 `pnpm <script>` 报 `ERR_PNPM_IGNORED_BUILDS`，可直接用
`node node_modules/<pkg>/bin/<entry>.js` 绕过。（本机实测 `pnpm test` / `pnpm install` 正常，
此坑暂未复现。）

### Node 版本可能被沙箱自带的 v20 抢占

系统 Node 在 `C:\Program Files\nodejs`（v24）。若 PATH 前面有沙箱自带的 v20，
需先 `$env:Path = "C:\Program Files\nodejs;" + $env:Path` 再跑 pnpm/npm。

### 本机路径一律不要硬编码

早期代码里出现过**开发机专属的绝对路径**（codex 入口、日志目录），换机器即失效。
现在统一由 `services/codex_locator.rs`（入口）与 `Storage::log_file()`（日志）解析。
新增代码沿用这两个入口。

---

## 三、历史存档（已解决）

> 以下问题均已解决，保留仅为记录。**描述的是当时的形态，可能已与现状不符。**

### 3.1 代码写入 / 沙箱模式（✅ 3.10 解决）

早期 Flydex 用 `codex exec`（headless）驱动，而 **exec 模式不支持交互式审批**
（codex `exec/src/lib.rs` 对 `CommandExecutionRequestApproval` /
`FileChangeRequestApproval` 一律 reject），于是把 `approval_policy=on-request`
透传给 exec 只会让写操作被直接拒绝，表现为"无法写文件"。

现在会话改由 **`codex app-server`** 驱动（JSON-RPC over stdio），
`thread/start` 带 `approvalPolicy: "on-request"` + `approvalsReviewer: "user"` ——
**审批是真的**：工具执行前到达 `ServerRequest`，Flydex 的规则引擎先判断
（allow / deny / ask），ask 才弹审批卡等用户决定。

### 3.2 全缓冲 / 伪流式输出（✅ 已解决）

早期 codex 在非 TTY 下 stdout 全缓冲，只能等进程结束才看到输出；
后来一度用"等全文到达再用定时器逐字揭示"的假流式（首字延迟 = 整段生成时间）。

现在直接消费 app-server 的增量通知：
`item/agentMessage/delta`、`item/reasoning/textDelta`、
`item/reasoning/summaryTextDelta`，累积到 ~60ms 一次 setState。
第一个 token 到达即可显示。

### 3.3 Windows 下 `Command::new("codex")` 找不到可执行文件

npm 全局装的是 `codex.cmd`，Rust 不会自动补扩展名。
现在由 `codex_locator` 显式处理：PATH 上按 `codex.cmd` / `codex.exe` / `codex` 依次查找，
找不到再回退 `npm root -g` 下的 `@openai/codex/bin/codex.js`（用 node 跑）。

### 3.4 早期修复的若干前端/序列化 bug（任务 1.1 / 1.2）

- zustand `setStatus` 误传函数式更新 → status 变函数对象、读 `.color` 崩溃（白屏）
- StrictMode 下 `useEffect` 双执行导致事件监听器泄漏 → 输出重复
- `rename_all = "snake_case"` 把 `thread.started` 变成 `thread_started`（带点号）→ JSONL 解析失败
- `CodexEvent::Json { data }` 与 serde `content = "data"` 冲突 → 双层嵌套
- rehype-highlight 把代码块变成元素数组，`String(children)` 得到 `[object Object]`
