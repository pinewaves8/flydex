# Flydex 项目规范

> 本文件是 Flydex 的开发规范。它由 **codex 原生加载**（`AGENTS.override.md` →
> `AGENTS.md`，从项目根逐级到 cwd 拼接）。因此无论是用 codex CLI、还是用 Flydex
> 本身（Flydex 也走同一套 harness）开发本项目，这些约定都同等生效。

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
| 项目规范加载 | codex 原生读取 `AGENTS.override.md` → `AGENTS.md`（从项目根逐级到 cwd 拼接），可用 `project_doc_fallback_filenames` 追加 `CLAUDE.md` 等回退名 |
| 会话列表 | `thread/list`（含 `sourceKinds` / `modelProviders` / `archived` / 分页） |
| 会话消息 | `thread/turns/list`（**必须显式传 `itemsView: "full"`**，见 §2.5-A） |
| 会话搜索 | `thread/search`（粒度=会话） |
| 上下文压缩 | `thread/compact/start`（**异步、无完成通知**，见 §2.5-B） |
| 回退到某一轮 | `thread/revert`（**只支持 paginated 历史模式**，见 §2.5-C） |
| 运行中插话 | `turn/steer`（必须带 `expectedTurnId` 做乐观并发保护） |
| 项目归属 | `project/list|create|update|delete` + `thread/metadata/update` 设 `projectId` |
| 文件名搜索 | `fuzzyFileSearch`（模糊匹配 + 返回命中位置，可做高亮） |
| 会话导出 | **codex 无此接口**，由 Flydex 自行渲染（`features/codex/threadExport.ts`） |

### 2.4 收敛进度

**已完成**

| 目标 | 落点 |
|---|---|
| 会话/项目存储 | 全部走 `thread/*` / `project/*`；Flydex 侧 `storage.rs` 退化为旧会话只读归档（P0–P9） |
| 会话搜索 | `thread/search`（`Ctrl+R`）；命中定位改为本地匹配（见 §2.5-D） |
| 上下文压缩 | `thread/compact/start`，替换了原先"生成摘要插一条消息"的假压缩 |
| 回退到某一轮 | `thread/revert`（新建会话使用 paginated 历史模式） |
| 运行中插话 | `turn/steer` |
| @-mention 文件搜索 | `fuzzyFileSearch`（空查询仍用本地列表兜底，见 §2.5-E） |
| 项目规范加载 | codex 原生（删除了 Flydex 自行拼注入块的做法） |

**已评估、决定不做（附原因 —— 别再重复评估）**

| 目标 | 不做的原因 |
|---|---|
| 模型列表 `model/list` | 只返回 **OpenAI 自家模型**（实测 5 条），**不含**用户配置的供应商。Flydex 的 provider 是按会话下发的，codex 的全局目录不可能知道它 —— 换过去等于把用户配的供应商弄丢 |
| 技能列表 `skills/list` | 只给 `{name, description, path, scope, enabled}`，**不给内容**；而 Flydex 的技能注入是 `skill.prompt + 用户输入`，prompt 来自 SKILL.md 正文。换过去 `/plan` 会静默地只发用户那句话 |
| hooks `hooks/list` | 与 Flydex 的 `hooks.json` **不是同一个概念**（实测返回空） |
| 代码审查 `review/start` | **未验证**。鉴于上面三项都是"名字相似、语义不同"，没有贸然推进 |

**仍待处理（收益递减，优先级低）**

| 目标 | 应改为 |
|---|---|
| 文件变更检测 | `turn/diff/updated` 已转发到前端，但 UI 仍在用 `git_status_changes` 反推 |
| 文件 IO | `fs/readDirectory` / `fs/readFile` 可用（**要求绝对路径**），但价值一般 |
| 上下文压缩自动化 | 目前仍靠手动触发；codex 支持自动压缩 |

### 2.5 codex 侧实测陷阱（踩过的，别再踩）

源码注释、协议文档都可能与运行时行为不一致。以下均为**实测**结论：

| # | 事实 | 影响 |
|---|---|---|
| **A** | `thread/turns/list` 的 **`itemsView` 参数缺省是 `Summary`**（协议里 `TurnItemsView::default()` 却是 `Full`，但参数缺省走 Summary） | 不显式传 `"full"`，每轮只返回首条 userMessage + 末条 agentMessage（实测丢 19/51 个 item） |
| **B** | `thread/list` **不传 `modelProviders` 时，默认只返回 daemon 自己配置的那个 provider 的线程**（`None => Some(vec![config.model_provider_id])`） | Flydex 的 provider 是按会话下发的 `flydex_<id>`，**自家会话会被整片过滤掉**。必须显式传 **空数组**（协议注释："When present but empty, includes all providers"）。实测 230 → 340 条 |
| **C** | `thread/revert` **只支持 `paginated` 历史模式**；默认是 `legacy` | 新建会话需在 `thread/start` 显式带 `historyMode: "paginated"`。paginated 线程在 `read`/`resume`/`list` 上一切照常（**已跨进程复测**） |
| **D** | `thread/compacted` 通知**对 v2 客户端不发**（源码标为 deprecated，"v2 clients receive the canonical ContextCompaction item instead"）；且压缩**会把整个会话历史重写成一条以固定前缀开头的 userMessage** | 等通知是白等；**没有完成信号**，只能轮询历史是否已被重写。压缩结果必须专门渲染，否则那段英文会冒充"用户提问"糊满一屏 |
| **E** | `fuzzyFileSearch` **对空查询返回 0 条**；`fs/*` **要求绝对路径** | 空查询的补全必须由本地文件列表兜底；相对路径报 `AbsolutePathBuf deserialized without a base path` |
| **F** | `thread/searchOccurrences` **未实现**（协议里有，服务端返回 `is not supported yet`） | 二级定位要自己兜底（本地匹配已加载消息） |
| **G** | `thread/delete` **不会**因被 fork 引用而拒绝，也不级联（旧注释称会拒绝，**实测为假**） | 只删父会留下孤儿分支；级联删除是 **Flydex 的产品决定**，不是协议要求 |
| **H** | `thread/list` 会隐藏 `archived = 1` 与 `preview = ''` 的线程 | 新建会话不应立刻 `thread/start`（否则留下点不开的空会话）；"会话消失"先查回收站 |
| **I** | `Thread.created_at` / `updated_at` 是 **Unix 秒** | 排序键也要改：`thread/list` 默认按 `created_at`，须显式传 `sortKey: 'updated_at'` |

**排查姿势**：症状 → **先找"决定可见性的条件全集"**（读 `codex-rs/state/src/runtime/threads.rs` 的 `push_thread_filters`，或 `rollout/src/recorder.rs` 的 `list_threads*`），逐条排除。**不要在不了解全貌的参数空间里穷举** —— 2026-09-11 排查"新会话消失"时，我穷举了 6 轮参数组合才去读源码，一读就看到了决定性条件。

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
node node_modules/eslint/bin/eslint.js src --ext ts,tsx
pnpm test                 # vitest，纯函数单测（线程 item 映射 / 导出 / 路径归一）
node node_modules/vite/bin/vite.js build
```

- 新增公共函数要有单测（Rust 用 `#[cfg(test)]` 内嵌；前端纯函数放 `*.test.ts`）
- `cargo fmt` **只对自己改过的文件**跑，不要全仓格式化（会把无关文件卷进 diff）
- 提交前必须全绿；`cargo build` 要求**零 warning**

### 7.1 端到端：必须覆盖真实用户路径

**同进程/单一路径验证通过 ≠ 功能可用。** 改完要问"用户会怎么走这条路"，至少覆盖：

- **新建会话** → 发消息 → 确认它出现在列表里且能被选中（2026-09-11 这条路径一次没点过，
  用户一点就撞出三个 bug：三个"新建会话"入口各自为政、草稿被自动打开顶掉、列表滞后不可见）
- **切换 / 重启 / 跨进程**（P11 验证 paginated"一切照常"是在同一 daemon 会话内做的，
  跨进程才是真实场景）
- **回收站 / 恢复**（"会话消失"的第一嫌疑是它被归档了，不是丢了）

有 Rust 侧协议疑问时，用 `src-tauri/examples/probe_threads.rs` **打真 daemon 实测**，
不要靠读代码推断 —— 它已经纠正过多个错误假设（见 §2.5）。该探针**只读为主**，
写测试（`--create-project` / `--fork-probe` 等）一律**自建线程并自行清理**，
绝不拿用户已有会话做实验。

### 7.2 一个容易踩的构建陷阱

`custom-protocol` 特性会把 `dist/` **编译进二进制**。所以：

- 改前端后要跑**打包好的 exe**（或 `cargo build` 后运行），必须**先 `vite build` 再 `cargo build`**
- `pnpm tauri dev` 走 vite dev server，前端改动 HMR 即时生效，不受此影响
- 另：`tauri dev` 会 watch `src-tauri` 并自动重编译重启 —— 调试期间后端会自动重建

### 7.3 `cargo build` 报「拒绝访问」

若 `cargo build` 报 `拒绝访问 (os error 5)`，通常是**应用正在运行、占用 exe 文件**。
用 `cargo check` 验证编译即可，或先退出应用。

---

## 8. 提交规范

Conventional Commits，中文描述：

```
feat(harness): 复用 codex 原生能力重构模型配置
fix(model): config.toml 顶层键被解析进表内导致切模型失效
refactor(ui): 三个浮层共用 useListNavigation
```

- Flydex 的「自动 git 快照」功能会另产生 `flydex-checkpoint <时间戳>` 提交，属正常
- 不提交 `logs/`、`.tmp`、临时脚本（**失败路径上也要删**，别只在成功路径 `rm`）

> ⚠️ **自动快照的副作用**：Flydex 每轮结束会对**当前工作目录**执行
> `git add -A && git commit`。所以在这个仓库里开发 Flydex 时：
> - 你的改动可能在你还写完提交信息前就被 `flydex-checkpoint` 提交掉（本次开发中发生过，
>   导致详细的提交说明丢失、历史被无说明的快照穿插）
> - 提交前先 `git status` 确认，若发现"nothing to commit"而改动确实存在，说明已被快照提交
> - **不要让两个 agent 同时改这个仓库**（例如用 Flydex 的 agent 改 Flydex 自己），
>   会互相覆盖，且对方的改动会以无说明的快照混入历史

- 提交信息尾部加 `Co-Authored-By:` 行（若由 AI 协作完成）

---

## 9. 环境备忘

- **codex 仅支持 `wire_api = "responses"`**，`"chat"` 已被上游移除并会显式报错。
  接第三方供应商时确认其支持 `/v1/responses`（DeepSeek 支持）
- codex 配置读取优先级：per-thread `config` 参数 > `~/.codex/config.toml`
- Flydex **不应改写用户的 `~/.codex/config.toml`**（用户可能同时在用 codex CLI）
- **不要硬编码本机路径**：codex CLI 入口由 `services/codex_locator.rs` 解析
  （`FLYDEX_CODEX_JS` → PATH → `npm root -g` → 常见位置），失败时报出**试过哪些位置**；
  日志统一走 `Storage::log_file()`（`~/.flydex/logs/`）
- **CI**：`.github/workflows/test.yml`（前端 typecheck/test/build + Rust `cargo test --lib`，
  在 windows runner 上跑）。Rust job 需要**占位 `dist/`**：`tauri::generate_context!()`
  在编译期就要求 `frontendDist` 存在，而 `dist/` 是 gitignore 的
- 启动调试：`FLYDEX_DEVTOOLS=1 pnpm tauri dev` 可打开 webview devtools

---

## 10. 数据位置速查

| 数据 | 位置 | 说明 |
|---|---|---|
| 会话（thread）| `~/.codex/state_5.sqlite` + `~/.codex/sessions/**/rollout-*.jsonl` | **权威数据源**，messages、搜索、压缩都在这里 |
| 分页历史投影 | `~/.codex/thread_history_1.sqlite` | paginated 会话的 turns/items 投影 |
| 项目（codex 侧）| `~/.codex/state_5.sqlite` 的 `projects` / `project_roots` | |
| 旧会话（只读归档）| `~/.flydex/sessions/*.json` | **不再新增**，仅服务没有 threadId 的老会话，**只读、不可删** |
| Flydex 项目列表 | `~/.flydex/projects.json` | 语义降级为本地索引 |
| Flydex→codex 项目映射 | `~/.flydex/codex_projects.json` | 缓存 + 离线兜底；权威是 `project/list` |
| 会话级 UI 偏好 | `~/.flydex/thread_settings.json` | 目前只有"会话级模型覆盖"（codex 的 `Thread` 无此字段） |
| 日志 | `~/.flydex/logs/flydex-appserver.log` | |
