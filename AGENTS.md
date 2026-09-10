# Flydex 项目规范

> 本文件是 Flydex 的开发规范。它同时会被 codex 与 Flydex 自身加载
> (Flydex 的 `system_prompt.rs` 会在项目根查找 `AGENTS.md`)，所以这里的约定
> 对"人写代码"和"AI 写代码"同等生效。

---

## 1. 项目定位

Flydex 是**基于 OpenAI Codex 的跨平台桌面 AI 编程助手**（Tauri + Rust 后端 +
React/TypeScript 前端）。后端通过 JSON-RPC over stdio 驱动 `codex app-server`，
在原生窗口里提供对话、文件读写、命令执行、代码审查等能力。

参照系是 **Claude Code**；实现底座是 **codex harness**。

---

## 2. 第一原则：复用 codex harness，不要另造一套

**能由 codex 提供的，不在其之上重新实现。**

codex app-server 已经暴露了约 **55 条 server notification** 与约 **80 个 client
request method**，覆盖 thread 持久化/搜索/压缩/回退、任务清单、hooks、skills、
文件系统操作、项目管理等。Flydex 应当做的是**消费**它们，而不是维护平行实现。

### 2.1 分层判据

| 归属 | 内容 |
|---|---|
| **codex harness 拥有** | 状态与持久化：thread、消息历史、搜索、压缩、回退、任务清单、hooks、skills、文件 IO、模型与供应商解析 |
| **Flydex 拥有** | 呈现与交互：窗口布局、侧边栏、主题、Markdown 渲染、diff 可视化、输入框与附件、命令面板、搜索结果展示 |

一句话：**Flydex 决定"怎么显示"，不决定"状态存哪、结果谁算的"。**

### 2.2 动手前必须先查

改任何与 harness 能力沾边的功能前，**先 grep 一手 vendored codex 源码**：

```
codex/codex-rs/app-server-protocol/src/protocol/common.rs   # 全部方法名与通知名
codex/codex-rs/app-server-protocol/src/protocol/v2/          # 各请求/通知的载荷结构
```

方法/通知清单在 `common.rs` 的 `client_request_definitions!` 与
`server_notification_definitions!` 两个宏里。**通常已经有现成机制。**

> 教训：曾断言"codex 不传 token 计数，只能估算"，实际有 `thread/tokenUsage/updated`；
> 曾断言"计划进度只能猜"，实际有 `turn/plan/updated` 带结构化 `step + status`。
> 两次都是先下结论、后调研导致返工。**先查，再说。**

### 2.3 已确认为 harness 原生、Flydex 已接入的

| 能力 | harness 机制 |
|---|---|
| 模型与供应商 | `thread/start` / `thread/resume` 的 `config` 参数（含 `model_providers.<id>`） |
| 流式输出 | `item/agentMessage/delta`、`item/reasoning/textDelta`、`item/reasoning/summaryTextDelta` |
| 任务清单 | `turn/plan/updated`（`Vec<TurnPlanStep{step, status}>`） |
| 本轮 diff | `turn/diff/updated` |
| Token 用量 | `thread/tokenUsage/updated` |
| 审查 diff | `git_review_diff` + `write_review_diff`（Flydex 自有，配合 codex 审查模式） |

### 2.4 待收敛清单（按收益排序）

| 优先级 | 目标 | 现状 | 应改为 |
|---|---|---|---|
| 高 | 会话搜索 | 每次按键加载全部会话文件、逐条比对 | `thread/search` / `thread/searchOccurrences` |
| 高 | AGENTS.md 注入 | `system_prompt.rs` 自读+截断，经 `developer_instructions` 注入 → **每轮重复发送同一份文件** | 传 `{"project_doc_fallback_filenames": [...]}` 让 codex 自己读，删除 `system_prompt.rs` |
| 中 | 上下文压缩 | 手动按钮 + 自实现摘要 | `thread/compact/start` + `thread/compacted` 通知，可做自动压缩 |
| 中 | 会话/项目存储 | 自有 `storage.rs`（含回收站/fork/导出）与 `projects.json` | `thread/*` / `project/*`，单一数据源，并白得 `thread/revert` 回退能力 |
| 低 | 文件变更检测 | 扫 `git_status_changes` 反推 | `turn/diff/updated` / `fs/changed` |
| 低 | 文件 IO | 自实现 `list_directory` / `list_files` / `init_writer` | `fs/readDirectory` / `fs/readFile` / `fs/writeFile` / `fs/watch` |
| 低 | hooks / skills | 自有 `hooks.json`、`skill_list` | `hooks/list`、`skills/list`（codex 已自带 hooks 与 `hook/started`/`hook/completed` 通知） |

---

## 3. 第二原则：对齐 Claude Code 的行为与观感

Claude Code 是首要参照系。做交互与展示决策时先问"Claude Code 这里怎么做"，
并在改动说明里讲清与之的差异及原因。

已对齐的行为（作为风格基准）：

- `Plan` 卡片：5 秒倒计时自动执行，用户可立即执行或取消
- 工具调用：默认折叠为紧凑单行；连续多次调用归并为一张可折叠卡
- 思考内容：优先用 `summary` 流；摘要为空时回退原文且**只显示尾部**（尾 400 字符 + 渐隐）
- 长输出：`tool` 卡片默认折叠，展开才看全文
- 命令面板（`/`）、文件引用（`@`）、全局搜索（`Ctrl+R`）的交互形态

---

## 4. 第三原则：错误必须可见

**任何失败路径都要有可见输出，不允许静默吞掉。**

踩过的坑：codex 的模型报错只写进 `~/.codex/config.toml` 相关日志与 app-server 的
stderr，前端毫无提示，表现为"跑了几十秒什么都没发生" —— 排查了很久。

要求：

- app-server 的 stderr **ERROR** 必须转发到 UI
- `turn.completed` 若 `output_tokens == 0` 且本轮无 agent 消息，要提示可能原因
  （模型 ID 不支持 / 上下文超限 / 供应商异常）
- 新增的 `Result<T, String>` 错误必须能到达用户可见的位置

---

## 5. 技术栈与目录

```
src-tauri/src/
  commands/      #[tauri::command] 入口，只做参数转换与调用 service
  services/      业务逻辑（appserver_client 是 codex JSON-RPC 的唯一出口）
  models/        serde 数据结构
  types/         跨模块共享类型
src/
  components/    ui/（原子组件）、layout/（框架布局）
  features/      按领域划分的业务模块
  services/      前端 service（封装 invoke）
  stores/        zustand，一个文件一个 domain
  hooks/         可复用 hooks
```

**约束**：命令层不写业务逻辑；前端不直接 `invoke` 裸命令（走 `services/`）；
`appserver_client.rs` 是唯一与 codex 通信的地方。

---

## 6. 代码风格

### Rust
- `pub` 函数必须有中文 doc 注释
- 错误统一 `Result<T, String>`；生产路径不 `unwrap()` / `panic!`
- 日志用 `debug_log!`，不用 `println!`
- 长操作 `async`，不阻塞 Tauri 事件循环
- 字符串切片注意 UTF-8 字符边界（`is_char_boundary`）—— 中文场景必踩

### TypeScript
- 严格模式，`noUnusedLocals`
- `export` 函数写中文 JSDoc
- 对象形状优先 `interface`
- 组件内 hook 必须在顶层声明，**不得放进条件分支**

---

## 7. 验证要求

改后端（`src-tauri/`）：

```bash
cd src-tauri && cargo test --lib && cargo check
```

改前端（`src/`）：

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node node_modules/eslint/bin/eslint.js <改动文件>
```

- 新增公共函数要有单测（Rust 用 `#[cfg(test)]` 内嵌）
- `cargo fmt` **只对自己改过的文件**跑，不要全仓格式化（会把无关文件卷进 diff）
- 提交前四项必须全绿

---

## 8. 提交规范

Conventional Commits，中文描述：

```
feat(harness): 复用 codex 原生能力重构模型配置
fix(model): config.toml 顶层键被解析进表内导致切模型失效
refactor(ui): 三个浮层共用 useListNavigation
```

- Flydex 的「自动 git 快照」功能会另产生 `flydex-checkpoint <时间戳>` 提交，属正常
- 不提交 `logs/`、`.tmp`、临时脚本
- 提交信息尾部加 `Co-Authored-By:` 行（若由 AI 协作完成）

---

## 9. 环境备忘

- **codex 仅支持 `wire_api = "responses"`**，`"chat"` 已被上游移除并会显式报错。
  接第三方供应商时确认其支持 `/v1/responses`（DeepSeek 支持）
- codex 配置读取优先级：per-thread `config` 参数 > `~/.codex/config.toml`
- Flydex **不应改写用户的 `~/.codex/config.toml`**（用户可能同时在用 codex CLI）
- 启动调试：`FLYDEX_DEVTOOLS=1 pnpm tauri dev` 可打开 webview devtools
