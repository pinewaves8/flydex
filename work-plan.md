# Codex 桌面版 — 详细工作计划文档

> 版本：v1.0  
> 日期：2026-08-25  
> 工作方式：**每开始一个新任务，先讨论再执行**  
> 项目根目录：`C:\llm\flydex`  
> 已有资源：Codex 开源源码（`./codex/`，含 codex-rs + codex-cli）、需求分析文档

---

## 工作原则

1. **讨论先行**：每个任务开始前，先在对话中讨论方案、确认范围，达成一致后再动手
2. **小步快跑**：任务粒度控制在 0.5-2 天可完成，每个任务结束有可验证的交付物
3. **随时可运行**：主分支始终保持可编译、可运行状态，新功能在分支上开发
4. **文档同步**：每个任务完成后更新相关文档（架构决策、API 说明、变更日志）
5. **回顾调整**：每个阶段结束后做一次回顾，评估进度、调整后续计划
6. **分支开发**：每个新开发任务从 master 切独立分支（`feat/<任务>` / `fix/<任务>`），完成并验证（typecheck + cargo check + 实机）后合并回 master 再推送，master 始终保持可编译可运行

---

## 技术栈最终确认

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 桌面框架 | Tauri | 2.x | Rust 后端 + Web 前端，体积小、性能好 |
| 前端框架 | React | 18+ | 函数组件 + Hooks |
| 语言 | TypeScript | 5.x | 全栈类型安全 |
| 构建工具 | Vite | 5.x | 快速热更新 |
| 样式 | Tailwind CSS | 3.x | 原子化 CSS |
| 组件库 | shadcn/ui | latest | 可定制、无头组件 |
| 状态管理 | Zustand | 4.x | 轻量、简洁 |
| 服务端状态 | TanStack Query | 5.x | 异步状态管理 |
| 代码编辑器 | CodeMirror 6 | latest | 语法高亮 + Diff |
| 终端仿真 | xterm.js | 5.x | 终端渲染 |
| 本地数据库 | SQLite (via rusqlite) | latest | 会话持久化 |
| Codex 集成 | **待验证**（见任务 0.3） | — | codex-rs 直接依赖 vs codex-cli stdio 通信 |

---

## 阶段总览

```
阶段0：项目初始化与技术验证  ← 当前位置
  ├─ 0.1 项目脚手架搭建
  ├─ 0.2 开发环境配置
  ├─ 0.3 Codex 集成方案验证（关键决策点）
  └─ 0.4 架构骨架与目录规范

阶段1：关键路径原型（核心交互闭环）
  ├─ 1.1 左侧边栏（项目+会话列表）
  ├─ 1.2 对话输入区
  ├─ 1.3 对话消息渲染（流式+工具调用卡片）
  ├─ 1.4 文件操作可视化（diff查看+逐块接受）
  ├─ 1.5 审批拦截交互
  ├─ 1.6 内置终端（基础PTY）
  └─ 1.7 端到端闭环联调

阶段2：视觉风格分化与定稿
  ├─ 2.1 主题系统架构
  ├─ 2.2 风格A：开发者极客风
  ├─ 2.3 风格B：产品级简洁风
  └─ 2.4 风格对比评审与定稿

阶段3：核心功能模块扩展
  ├─ 3.1 Git 集成（分支+diff+提交）
  ├─ 3.2 代码审查（/review）
  ├─ 3.3 MCP 客户端
  ├─ 3.4 Skills 系统
  ├─ 3.5 图像附件
  ├─ 3.6 计划模式
  ├─ 3.7 会话历史管理
  ├─ 3.8 模型配置管理
  └─ 3.9 沙箱与审批策略可视化

阶段4：跨平台适配与构建
  ├─ 4.1 Windows 平台适配
  ├─ 4.2 macOS 平台适配
  ├─ 4.3 自动更新机制
  ├─ 4.4 安装包构建与签名
  └─ 4.5 性能优化

阶段5：打磨、测试与发布准备
  ├─ 5.1 端到端测试
  ├─ 5.2 可访问性
  ├─ 5.3 国际化（中/英）
  ├─ 5.4 崩溃恢复与数据完整性
  ├─ 5.5 文档与帮助
  └─ 5.6 Beta 发布

阶段6：对标 Codex/Claude Code 能力升级与自进化（2026-09-02 规划）
  ├─ 6.0 差距分析 + 自进化定义（本文档）
  ├─ 6.1 上下文与记忆（CLAUDE.md 分层 + 自动 compact + 记忆自动更新）✅ 已完成
  ├─ 6.2 自主执行（审批规则化 + 全自动模式）✅ 已完成
  ├─ 6.3 工具生态（web 工具 + 子代理并行）✅ 已完成
  ├─ 6.4 可靠性（checkpoint + 沙箱 + 重试）✅ 已完成（2026-09-04 四项全闭环）
  └─ 6.5 自进化闭环（skill 自动沉淀 + 记忆自动更新 + 配置反馈优化）✅ 已完成（2026-09-04）
```

---

## 阶段0：项目初始化与技术验证

> **目标**：搭建可运行的 Tauri + React 项目骨架，验证 Codex 集成方案，确立架构规范  
> **预估**：3-5 天  
> **退出标准**：`npm run tauri dev` 可启动应用，显示 Hello World 窗口；Codex 集成方案验证完成并形成决策记录

### 任务 0.1：项目脚手架搭建

| 项 | 内容 |
|----|------|
| **描述** | 使用 Tauri 2.x CLI 创建项目，配置 React + TypeScript + Vite + Tailwind CSS + shadcn/ui |
| **前置依赖** | 无 |
| **交付物** | 可运行的项目骨架，`npm run tauri dev` 启动后显示空白窗口 |
| **验收标准** | 1. 项目编译无错误 2. 热更新正常 3. Tailwind 类名生效 4. 目录结构符合规范 |
| **预估** | 0.5 天 |

**具体步骤：**
1. `npm create tauri-app@latest` 创建项目（选择 React + TypeScript + Vite）
2. 安装并配置 Tailwind CSS 3.x
3. 初始化 shadcn/ui（`npx shadcn@latest init`）
4. 配置路径别名 `@/` 指向 `src/`
5. 安装基础依赖：zustand、@tanstack/react-query、lucide-react
6. 验证：启动应用，修改 App.tsx 触发热更新

### 任务 0.2：开发环境配置

| 项 | 内容 |
|----|------|
| **描述** | 配置 ESLint、Prettier、Husky、commitlint、VS Code 工作区设置，确保团队开发规范一致 |
| **前置依赖** | 0.1 |
| **交付物** | 完整的代码规范配置，提交时自动 lint + format |
| **验收标准** | 1. `npm run lint` 无错误 2. `npm run format` 可格式化 3. git commit 触发 husky 钩子 4. VS Code 保存时自动格式化 |
| **预估** | 0.5 天 |

**具体步骤：**
1. 配置 ESLint（typescript-eslint + react-hooks + import 排序）
2. 配置 Prettier（与 Tailwind 插件集成）
3. 安装 Husky + lint-staged，pre-commit 时运行 lint + format
4. 配置 commitlint（Conventional Commits 规范）
5. 创建 `.vscode/settings.json`（保存自动格式化、ESLint 修复）
6. 创建 `.editorconfig`

### 任务 0.3：Codex 集成方案验证 ⚠️ 关键决策点

| 项 | 内容 |
|----|------|
| **描述** | 验证两种 Codex 集成方案的可行性，形成技术决策记录（ADR） |
| **前置依赖** | 0.1 |
| **交付物** | 可运行的 PoC（两种方案各一个最小验证）+ 决策记录文档 |
| **验收标准** | 1. 两种方案均能成功发送一条消息并获得回复 2. 性能数据对比（启动耗时、内存、消息延迟）3. 集成复杂度评估 4. 明确选择一种方案 |
| **预估** | 1-2 天 |

**方案 A：codex-rs 直接依赖（Rust 库引入）**
- 将 `./codex/codex-rs` 作为 Rust crate 依赖引入 Tauri 后端
- 直接调用 Codex agent 的 Rust API
- 优点：性能最好、无进程通信开销、类型安全、深度集成
- 风险：codex-rs API 可能不稳定、编译复杂度高、版本锁定困难

**方案 B：codex-cli stdio 通信（子进程 + JSON-RPC）**
- 打包 codex-cli 二进制，Tauri 后端通过 stdio 启动子进程
- 使用 JSON-RPC 协议与子进程通信
- 优点：解耦、CLI 升级独立、稳定性高、官方支持的集成方式
- 风险：进程通信开销、需要维护 JSON-RPC 协议层、二进制打包跨平台复杂

**验证步骤：**
1. 阅读 `./codex/codex-rs` 的 crate 结构和公开 API
2. 方案 A PoC：在 Tauri 后端引入 codex-rs，调用最简单的 agent 接口
3. 方案 B PoC：spawn codex-cli 子进程，通过 stdio 发送一条 exec 命令
4. 对比：编译时间、运行内存、消息往返延迟、代码复杂度
5. 输出决策：选择方案 + 理由 + 风险应对

### 任务 0.4：架构骨架与目录规范

| 项 | 内容 |
|----|------|
| **描述** | 确立前后端目录结构、IPC 通信规范、状态管理规范、组件设计规范 |
| **前置依赖** | 0.3 |
| **交付物** | 完整的目录结构 + 架构规范文档 + 示例代码（一个完整的 IPC 调用链路示例） |
| **验收标准** | 1. 目录结构清晰，职责分离 2. IPC 命令有统一的类型定义 3. 状态管理有规范的 store 模板 4. 组件有统一的设计规范 5. 新成员可根据文档快速上手 |
| **预估** | 1 天 |

**前端目录结构：**
```
src/
├── components/          # 通用组件（按功能域分子目录）
│   ├── ui/             # shadcn/ui 基础组件
│   ├── layout/         # 布局组件（侧边栏、面板、工具栏）
│   ├── chat/           # 对话相关组件
│   ├── editor/         # 代码编辑器/Diff 组件
│   ├── terminal/       # 终端组件
│   └── git/            # Git 相关组件
├── stores/             # Zustand stores
│   ├── sessionStore.ts
│   ├── projectStore.ts
│   ├── uiStore.ts
│   └── settingsStore.ts
├── hooks/              # 自定义 React Hooks
│   ├── useChat.ts
│   ├── useTerminal.ts
│   └── useIpc.ts
├── services/           # 业务逻辑层（封装 IPC 调用）
│   ├── codexService.ts
│   ├── projectService.ts
│   └── gitService.ts
├── types/              # TypeScript 类型定义
│   ├── ipc.ts          # IPC 命令/事件类型
│   ├── codex.ts        # Codex 相关类型
│   └── index.ts
├── lib/                # 工具函数
│   ├── utils.ts
│   └── constants.ts
├── styles/             # 全局样式
│   └── globals.css
├── App.tsx
└── main.tsx
```

**后端目录结构：**
```
src-tauri/src/
├── main.rs              # 入口
├── lib.rs               # 库导出
├── commands/            # Tauri 命令（IPC 接口层）
│   ├── mod.rs
│   ├── session.rs
│   ├── project.rs
│   ├── codex.rs
│   ├── terminal.rs
│   └── git.rs
├── services/            # 业务逻辑层
│   ├── mod.rs
│   ├── codex_manager.rs # Codex 进程/实例管理
│   ├── session_manager.rs
│   ├── terminal_manager.rs
│   └── git_service.rs
├── models/              # 数据模型
│   ├── mod.rs
│   ├── session.rs
│   ├── message.rs
│   └── file_change.rs
├── db/                  # 数据库层
│   ├── mod.rs
│   ├── schema.rs
│   └── migrations/
├── config/              # 配置管理
│   ├── mod.rs
│   └── settings.rs
├── security/            # 安全模块（沙箱、审批）
│   ├── mod.rs
│   ├── sandbox.rs
│   └── approval.rs
└── error.rs             # 统一错误类型
```

**IPC 通信规范：**
- 命令命名：`<domain>:<action>`，如 `session:create`、`codex:send_message`
- 所有命令有统一的返回类型：`Result<T, AppError>`
- 事件命名：`<domain>:<event>`，如 `codex:message_delta`、`terminal:output`
- 类型定义前后端共享：通过 ts-rs 或手动维护 `src/types/ipc.ts`

---

## 阶段1：关键路径原型（核心交互闭环）

> **目标**：实现一个完整的交互闭环——打开项目 → 发送消息 → Agent 流式回复 → 工具调用 → 文件修改 → 审批 → diff 查看 → 终端输出  
> **预估**：10-15 天  
> **退出标准**：用户可以在应用中完成一次真实的 Codex 对话，包含文件修改和命令执行，所有中间步骤可视化

### 任务 1.1：左侧边栏（项目 + 会话列表）

| 项 | 内容 |
|----|------|
| **描述** | 实现左侧边栏，包含项目列表和当前项目的会话列表 |
| **前置依赖** | 0.4 |
| **交付物** | 可交互的侧边栏组件 |
| **验收标准** | 1. 显示最近项目列表（可手动添加文件夹）2. 点击项目切换当前项目 3. 显示当前项目的会话列表 4. 点击会话切换 5. 新建会话按钮 6. 侧边栏可折叠 |
| **预估** | 1.5 天 |

**讨论要点（执行前确认）：**
- 项目数据是存本地 JSON 还是 SQLite？（建议 SQLite，与会话统一）
- 会话列表是否需要分组/收藏？（MVP 先不做，只按时间排序）
- 项目图标如何显示？（默认文件夹图标，检测到 Git 显示分支名）

### 任务 1.2：对话输入区

| 项 | 内容 |
|----|------|
| **描述** | 实现底部对话输入区，包含多行文本输入、发送按钮、模型选择器、附件按钮 |
| **前置依赖** | 1.1 |
| **交付物** | 功能完整的输入区组件 |
| **验收标准** | 1. 多行文本输入，自动高度扩展 2. Enter 发送，Shift+Enter 换行 3. 模型选择下拉（先硬编码几个选项）4. 附件按钮（先占位，图像附件在 3.5 做）5. 输入框聚焦/失焦样式 6. `/` 斜杠命令触发自动补全面板（先做 UI 框架，命令列表后续填充） |
| **预估** | 1.5 天 |

**讨论要点：**
- 输入框用 textarea 还是 CodeMirror？（建议 textarea + 自动高度，MVP 够用）
- 斜杠命令补全的触发和交互细节？
- 模型选择器是下拉还是弹窗？（建议下拉，简洁）

### 任务 1.3：对话消息渲染（流式 + 工具调用卡片）

| 项 | 内容 |
|----|------|
| **描述** | 实现对话消息列表，支持流式渲染 Agent 回复、工具调用卡片、Markdown 渲染 |
| **前置依赖** | 1.2 |
| **交付物** | 消息渲染组件 + 流式更新逻辑 |
| **验收标准** | 1. 用户消息右侧气泡显示 2. Agent 消息左侧流式渲染（逐字出现）3. Markdown 渲染（代码块带语法高亮+复制按钮）4. 工具调用卡片显示（工具名、参数、状态：执行中/成功/失败）5. 消息列表自动滚动到底部 6. 支持中断当前生成 |
| **预估** | 2.5 天 |

**讨论要点：**
- 流式渲染是通过 SSE 还是 WebSocket 还是 Tauri 事件？（取决于 0.3 的集成方案，建议 Tauri 事件）
- 工具调用卡片的展开/折叠交互？
- Markdown 渲染用什么库？（react-markdown + remark-gfm + rehype-highlight）
- 代码块的复制按钮和语言标签？

### 任务 1.4：文件操作可视化（Diff 查看 + 逐块接受）

> **状态：✅ 已完成（2026-09-01）**
> **实现摘要**：按调研推荐改为**整文件粒度**（不做逐块接受，对齐 Claude Code 官方趋势——"接受不相干子集会产生拼不起来的代码"）；diff 来源为 `git diff`（新增文件用 `git diff --no-index /dev/null`；删除/非 git 仓库特判标注）；复用 Git 面板同一套 diff 渲染（抽象为共享 `DiffViewer` 组件）；文件变更以内联 `FileChangeCard` 卡片插入对话流（文件列表 + kind 图标 + 懒加载 diff + 接受保留/拒绝回滚 + 全部接受/拒绝）。新增后端命令 `git_diff_file` / `git_discard_file`（自动处理 tracked/untracked/删除 + 路径归一化）。

| 项 | 内容 |
|----|------|
| **描述** | 实现文件修改的可视化，工具调用卡片中显示 diff，支持逐块接受/拒绝修改 |
| **前置依赖** | 1.3 |
| **交付物** | Diff 渲染组件 + 文件修改应用逻辑 |
| **验收标准** | 1. Agent 修改文件后，工具卡片中显示 diff 预览 2. 点击展开完整 diff 视图（分栏式）3. 支持逐块接受/拒绝修改 4. 接受的修改写入磁盘 5. 显示修改文件列表（新增/修改/删除标记）6. 未应用的修改有明显视觉标记 |
| **预估** | 2 天 |

**讨论要点：**
- Diff 渲染用 CodeMirror 6 的 merge view 还是 @diff-components/react？（建议 CodeMirror 6 @codemirror/merge，与编辑器统一）
- 逐块接受的交互是按钮还是点击行号？
- 修改是先存暂存区再应用，还是直接写文件？（建议先存内存暂存区，用户接受后写磁盘）

### 任务 1.5：审批拦截交互

> **状态：✅ 已完成（2026-09-01）**
> **实现摘要**：经代码级核实，`codex exec --json` 事件流**不含 `approval_request` 事件**（写入前审批是 app-server 协议才具备的能力）。exec 模式下若触发审批请求，codex **直接拒绝该操作**（源码 exec/src/lib.rs：CommandExecutionRequestApproval / FileChangeRequestApproval 均 reject，提示 "not supported in exec mode"）——故 1.5 按**"写入后审查"**形态交付（对齐 Claude Code 的 acceptEdits）：文件写入后立即以 FileChangeCard 展示，用户可逐文件/全部"保留"或"回滚"。现有命令审批卡（approval_request 通路为 dead code）保留并标注"命令审批（实验性）"。

| 项 | 内容 |
|----|------|
| **描述** | 实现 Agent 操作需要审批时的拦截交互，包括审批卡片、批准/拒绝按钮、批准全部 |
| **前置依赖** | 1.4 |
| **交付物** | 审批交互组件 + 审批状态管理 |
| **验收标准** | 1. Agent 请求审批时，对话流中插入审批卡片 2. 卡片显示操作类型、目标、风险提示 3. 按钮：批准（仅本次）、批准全部（本次会话同类）、拒绝 4. 批准后 Agent 继续执行 5. 拒绝后 Agent 收到反馈并调整 6. 审批历史可追溯 |
| **预估** | 1.5 天 |

**讨论要点：**
- 审批卡片是内联在对话流中还是弹窗？（建议内联，上下文更连贯）
- "批准全部"的范围是当前会话还是永久？（建议当前会话，永久在设置里配）
- 危险操作是否需要额外确认（如输入"YES"）？（MVP 先不做，高风险操作红色警告即可）

### 任务 1.6：内置终端（基础 PTY）

| 项 | 内容 |
|----|------|
| **描述** | 实现右侧面板的内置终端，支持基本的 Shell 交互和 Agent 命令实时显示 |
| **前置依赖** | 1.3 |
| **交付物** | 可交互的终端组件 |
| **验收标准** | 1. 终端面板可打开/关闭 2. 支持基本 Shell 交互（输入命令、显示输出）3. Agent 执行的命令在终端中实时显示 4. 支持复制/粘贴 5. 多终端标签页 6. 终端工作目录跟随当前项目 |
| **预估** | 2 天 |

**讨论要点：**
- Windows 用 ConPTY，macOS 用原生 PTY，Tauri 有 portable-pty crate 可以统一
- Agent 命令是在共享终端中执行还是独立终端？（建议独立终端标签，避免干扰用户）
- 终端字体和主题？（先跟随应用主题，后续可自定义）

### 任务 1.7：端到端闭环联调

> **状态：✅ 已完成（2026-09-01）**
> **实现摘要**：跑通"打开项目 → 创建 hello.py → 文件变更卡片 → 运行输出 → 会话完成"完整闭环。联调修复：(1) codex 命令加 `--skip-git-repo-check`（否则非 git 目录报 "Not inside a trusted directory"）；(2) 打开非 git 目录时集中式引导初始化 git 仓库（全局 setCwd 入口，confirm 弹窗 + `git init`），git 化后文件变更卡片/Git 面板才可用；非 git 按"无卡片"处理（git 语义边界：untracked 文件修改不追踪，提示先做首次提交）。

| 项 | 内容 |
|----|------|
| **描述** | 将 1.1-1.6 的组件串联，完成一次真实的 Codex 对话全流程，修复联调中的问题 |
| **前置依赖** | 1.1-1.6 |
| **交付物** | 可完成完整交互闭环的原型应用 |
| **验收标准** | 1. 打开项目 → 发送"创建一个 hello.py 文件并运行"→ Agent 执行 → 文件修改 diff 显示 → 审批 → 终端显示运行结果 → 会话完成 2. 全程无崩溃 3. 流式渲染流畅 4. 所有状态正确同步 |
| **预估** | 1.5 天 |

**讨论要点：**
- 联调中可能发现的架构问题需要及时调整
- 是否需要录制 Demo 视频？（建议，用于阶段评审）

---

## 阶段2：视觉风格分化与定稿

> **目标**：基于阶段1的交互骨架，实现两种极端风格方向，对比评审后定稿  
> **预估**：5-7 天  
> **前置条件**：阶段1 关键路径闭环跑通，交互逻辑稳定

### 任务 2.1：主题系统架构

> **状态：✅ 已完成（2026-09-01）**
> **实现摘要**：useThemeStore（风格 geek/clean × 模式 dark/light + localStorage 持久化）；globals.css 多主题 CSS 变量（geek 近黑底/霓虹青/锐角，clean 深蓝灰/靛蓝/圆角），light 块在前 dark 块在后避免同特异性顺序覆盖；TitleBar 极客/简洁 + 深色/浅色切换按钮；App 启动应用已保存主题。修复过 :root[data-theme] 与 .dark[data-theme] 同特异性 (0,2,0) 顺序覆盖 bug 及 vite CSS 缓存问题。

| 项 | 内容 |
|----|------|
| **描述** | 实现基于 CSS 变量的主题系统，支持运行时切换主题、明/暗模式、主题持久化 |
| **前置依赖** | 1.7 |
| **交付物** | 主题系统 + 主题切换器 |
| **验收标准** | 1. 所有颜色通过 CSS 变量定义 2. 切换主题即时生效无需刷新 3. 明/暗模式切换 4. 主题选择持久化到本地 5. 新增主题只需添加一组 CSS 变量 |
| **预估** | 1 天 |

### 任务 2.2：风格 A — 开发者极客风

> **状态：✅ 已完成（2026-09-01）**
> **实现摘要**：geek 主题（深色近黑 #0a0a0a + 霓虹青 #00ffaa 主色 + 锐角 2px + 细边框微光阴影）；全局增强：青紫双径向渐变背景光晕（科技感）、青色调选区、按钮悬停青色发光、等宽代码字体贯穿。组件全部走语义 CSS 变量，自动适配。

| 项 | 内容 |
|----|------|
| **描述** | 实现高密度、终端美学、深色为主的极客风格主题 |
| **前置依赖** | 2.1 |
| **交付物** | 极客风主题包 + 组件样式调整 |
| **验收标准** | 1. 深色背景（接近纯黑 #0a0a0a）2. 高对比度霓虹强调色（如青色 #00ffaa 或紫色 #a855f7）3. Monospace 字体用于代码和数据 4. 紧凑间距（组件间距减少 20-30%）5. 终端风格边框（1px solid，无圆角或小圆角）6. 对标 Cursor / Zed / Warp 的视觉感受 |
| **预估** | 1.5 天 |

### 任务 2.3：风格 B — 产品级简洁风

> **状态：✅ 已完成（2026-09-01）**
> **实现摘要**：clean 主题（深色柔和深蓝灰 #101218 + 靛蓝 #6366f1 主色 + 圆角 10px + 柔和双层阴影，含浅色变体）；全局增强：靛蓝调选区、极淡靛蓝背景光晕（纯净呼吸感）、系统字体。组件全部走语义 CSS 变量，自动适配。

| 项 | 内容 |
|----|------|
| **描述** | 实现呼吸感强、圆角卡片、柔和阴影的产品级简洁风格 |
| **前置依赖** | 2.1 |
| **交付物** | 简洁风主题包 + 组件样式调整 |
| **验收标准** | 1. 浅色/柔和深色背景 2. 低饱和度品牌色（如蓝色 #3b82f6 或靛蓝 #6366f1）3. 圆角卡片（8-12px radius）4. 柔和阴影（多层 shadow）5. 宽松间距（组件间距增加 20-30%）6. 系统字体（SF Pro / Segoe UI）7. 对标 Linear / Vercel / Apple 设计语言 |
| **预估** | 1.5 天 |

### 任务 2.4：风格对比评审与定稿

> **状态：✅ 已完成（2026-09-01）**
> **评审结论：选 A —— 极客风（开发者极客风）定稿**（用户拍板）
> **决策理由**：
> - 目标用户即开发者本人（个人开发工具），极客风的信息密度与终端美学契合主场景（Codex/终端/Git 重度使用）
> - 近纯黑底 + 霓虹青在长时间代码/对话场景对比度高、护眼
> - 简洁风（clean）保留为可一键切换的备选主题，不删除
> - 默认主题为极客风（useThemeStore 默认 'geek'/'dark'，持久化）
> **定稿应用**：两套主题均可一键切换（TitleBar 极客/简洁 + 深色/浅色），组件全走语义 CSS 变量自动适配。

| 项 | 内容 |
|----|------|
| **描述** | 两种风格并排对比，评审后选择定稿方向，可能需要融合调整 |
| **前置依赖** | 2.2 + 2.3 |
| **交付物** | 风格评审记录 + 定稿主题 |
| **验收标准** | 1. 两种风格可一键切换对比 2. 形成评审结论（选 A / 选 B / 融合）3. 定稿主题应用到所有组件 4. 记录设计决策理由 |
| **预估** | 1 天 |

**讨论要点：**
- 评审标准：信息密度、视觉美观、专业感、学习成本、长时间使用舒适度
- 是否需要第三方反馈？（可以截图发给朋友/社区征求意见）
- 融合方向：比如极客风的信息密度 + 简洁风的圆角卡片？

---

## 阶段3：核心功能模块扩展

> **目标**：在稳定的交互骨架和视觉风格基础上，逐个扩展核心功能模块  
> **预估**：20-30 天  
> **说明**：每个模块独立可交付，可根据优先级调整顺序

### 任务 3.1：Git 集成（分支 + Diff + 提交）

| 项 | 内容 |
|----|------|
| **描述** | 实现 Git 分支管理、变更查看、提交功能 |
| **交付物** | Git 面板 + 分支选择器 + Diff 查看 + 提交对话框 |
| **验收标准** | 1. 顶部显示当前分支，点击切换 2. 创建/删除/重命名分支 3. 未提交变更列表 4. 分栏 Diff 查看 5. 逐块暂存/取消暂存 6. 提交（支持 Agent 生成 commit message）7. push/pull |
| **预估** | 3 天 |

### 任务 3.2：代码审查（/review）

| 项 | 内容 |
|----|------|
| **描述** | 实现 /review 命令的可视化，支持三种审查模式和结构化报告 |
| **交付物** | 审查触发入口 + 审查报告组件 |
| **验收标准** | 1. 支持 --base / --uncommitted / --commit 三种模式 2. 审查结果分级显示（严重/警告/建议/好评）3. 每个问题关联文件+行号，点击跳转 4. 报告可导出 Markdown |
| **预估** | 2 天 |

> **状态：✅ 已完成（2026-09-01）**
> **实现摘要**：应用层实现（codex CLI 无原生 review）。后端 CodexExecMode::Review + REVIEW_INSTRUCTION（结构化分级格式）+ read-only 沙箱；git_review_diff 三模式（uncommitted/commit/base）+ 临时 diff 文件（.flydex-review.diff，规避 cmd /c 换行截断）；前端 ReviewCard 分级 badge（严重/警告/建议/好评）+ 文件:行号复制 + 导出 Markdown；自然语言触发（/review、/rv、/cr、中文"审查"）。验收实测通过（test.md 审查出好评 + 总结）。
> **说明**：验收标准第 3 条"点击跳转"降级为"显示文件:行号 + 一键复制"（flydex 暂无代码编辑器，后续阶段补跳转）。

### 任务 3.3：MCP 客户端

| 项 | 内容 |
|----|------|
| **描述** | 实现 MCP Server 管理和工具调用 |
| **交付物** | MCP 设置页 + MCP 工具列表面板 |
| **验收标准** | 1. 添加/编辑/删除 MCP Server（stdio + SSE）2. 显示已连接 Server 和工具列表 3. 工具状态监控 4. Agent 可自动调用 MCP 工具 5. 手动调用测试 |
| **预估** | 3 天 |

### 任务 3.4：Skills 系统

> **状态：✅ 已完成（2026-09-02）**
> **实现摘要**：融合 Claude Code `/skill-name` + VS Code Command Palette 的双轨设计：
> - **技能加载**：后端扫描 `<project>/.codex/skills/*/SKILL.md` 解析 YAML frontmatter（name/description/triggers/interface）+ 三源合并（内置 web-search/review/plan + 项目技能 + MCP 衍生）
> - **三种交互方式**：（1）输入区直接 `/skill-name 需求` 触发；（2）`Ctrl+Shift+P` 或 Skills 按钮打开 Command Palette 搜索执行；（3）自然语言触发词自动匹配注入（"查一下 xxx"→自动调 web-search）
> - **核心创新 - 强制执行指令**：技能提示词从"软建议"改为"必须立即调用 xxx 工具"，并把用户查询词直接拼接到指令同一行（避免换行被模型当消息边界）。实测成功调起 `web_search` MCP 工具，agent 不再编造 browser/browsers 等不存在的工具
> - **副作用修复**：补完 MCP web-search server 配置（config.toml 缺 args 导致 server 启动失败）
> - **设置面板**：在 Settings 新增 Skills 标签，支持搜索/按来源筛选/启用禁用
> **说明**：MCP 衍生技能的 tool description 未自动捕获（需动态调 tools/list），现用 server 名做泛化 skill；后续可考虑启动时探测 MCP tool 列表做更精确的 skill 元数据

| 项 | 内容 |
|----|------|
| **描述** | 实现 Skills 浏览、调用、管理 |
| **交付物** | Skills 面板 + Skill 加载逻辑 |
| **验收标准** | 1. /skills 命令打开面板 2. 分类展示（官方/社区/项目本地）3. 搜索筛选 4. 手动调用 5. 自动触发（根据对话内容匹配）6. 项目级 Skills 自动加载 |
| **预估** | 2 天 |

### 任务 3.5：图像附件

> **状态：✅ 已完成（2026-09-02）**
> **实现摘要**：基于 codex 原生 `-i/--image <FILE>`（`codex exec` 与 `codex exec resume` 均支持）实现：
> - **后端**：新增 `save_attachment_image` 命令（base64 → 落盘到 `<workdir>/.flydex-attachments/`，返回相对路径，规避 Windows cmd /c 对绝对路径的引号解析问题）；`run_codex` 新增 `images` 参数 → `CodexManager` 构建 `-i <path>` 参数序列（相对路径，codex 以 workdir 为 cwd 可直接解析）
> - **前端**：输入区新增图片按钮（多选）、拖拽图片、剪贴板粘贴截图三种入口；`FileReader` 读 base64 → 落盘 → 缩略图预览（含保存中 spinner、单张移除）；发送时等待全部落盘完成后透传 `images`，发送后自动清空附件；纯图片（无文字）也可发送
> - **验证**：typecheck / vite build / cargo check 全部通过；CLI 实测 `codex exec -i <png>` 参数被正确接受（thread 正常启动，仅因模型服务商高负载导致回复失败，与改动无关）
> **说明**：图片通过 `-i` 附加到**初始 prompt**（新会话首轮）或 resume 后的该轮 prompt，多图按序 `-i` 传入。
> **⚠️ 实测发现并修复（2026-09-02 续）**：上传图片发送时 codex 报 `No prompt provided`（exit 1）。根因：codex 顶层 `-i/--image <FILE>...` 是 `num_args=1..` **贪婪多值参数**，会吞掉其后的所有非 option 参数（含位置 prompt）。原实现把 `-i <img>` 排在 prompt 之前 → prompt 被 `-i` 吞掉 → codex 收到空 prompt → 从 stdin 读（PTY 下 stdin 是 terminal）→ 报错。**修复**：把 `args.push(final_command)` 移到 `-i` 之前（prompt 先入 args，图片后置），命令变为 `codex exec <configs> <prompt> -i img1 -i img2`。经 CLI 实测：`codex exec 请用一句话回复OK -i ./img.jpg` 正常进入执行（此前 `codex exec -i ./img.jpg 请描述图片` 复现 `Reading prompt from stdin... / No prompt provided via stdin.`）。resume 模式的 `-i` 是子命令参数（num_args=1）不受影响。
> **✅ 实机验收通过（2026-09-02 16:06）**：用户上传《千里江山图》后，codex 正常识别图片内容并输出图片描述 + 项目上下文分析 + 建议，全链路（落盘 → `-i` 透传 → 模型识别 → 前端渲染）工作正常。期间另发现"上传一战战场伤员历史照片"时 MiniMax 返回 `image_content_policy_violation`（内容审核拦截），属**模型服务端内容安全策略**，与 Flydex 无关（良性图片验证通过）。

| 项 | 内容 |
|----|------|
| **描述** | 实现图像附件功能，支持拖拽、粘贴、截图 |
| **交付物** | 附件组件 + 图像预览 + AppShot 截图工具 |
| **验收标准** | 1. 拖拽图片到对话区附加 2. 剪贴板粘贴截图 3. 附件按钮选择文件 4. 缩略图预览，点击放大 5. 多图支持 6. Agent 可识别图像内容 |
| **预估** | 2 天 |

### 任务 3.6：计划模式

| 项 | 内容 |
|----|------|
| **描述** | 实现 Plan Mode，Agent 先生成计划再执行 |
| **交付物** | 计划模式开关 + 计划列表组件 + 逐步执行逻辑 |
| **验收标准** | 1. /plan-mode 或按钮切换 2. 开启后 Agent 先生成分步计划 3. 计划可编辑（修改/删除/重排序）4. 全部批准/逐步批准 5. 执行过程中每步显示结果 6. 完成后可触发 review |
| **预估** | 2 天 |

> **状态：✅ 已完成（2026-09-01）**
> **实现摘要**：应用层两阶段 Plan Mode（借鉴 Claude Code，codex CLI 无原生 plan mode）：
> - 计划轮：后端新增 `CodexExecMode::Plan`，`-c sandbox_mode=read-only`（硬约束无法写文件）+ 注入计划指令（编号步骤：目标/涉及文件/操作）；已有会话 resume 保持上下文，否则新开
> - 批准轮：`codex exec resume <thread_id>` 切回用户正常沙箱，按批准计划逐步执行（现有 tool/file 卡片显示每步结果）
> - 前端：ChatPanel 输入区 Plan toggle；`PlanCard` 组件（编号步骤解析、步骤编辑/删除/添加、批准并执行/取消计划）；useCodexStore 新增 `planMode`；useCodexSession 新增 `approvePlan`/`cancelPlan`、`run` 支持 mode 参数
> - 已验收：CLI 端到端实测 计划轮输出分步计划且不写文件 → 批准轮 resume 同会话创建文件成功（read-only 硬约束 + 指令双重生效）
> - 说明：逐步独立批准（每步一次 exec）未做，以"编辑筛选步骤 + 全部批准"替代（MVP 合理）；完成后触发 review 衔接 3.2

### 任务 3.7：会话历史管理

> **状态：✅ 已完成（2026-09-02）**
> **实现摘要**：
> - **Step 0 关键 bug 修复**：把 autosave 从 ChatPanel 下移到 useCodexStore（zustand subscribe + debounce），避免 load+save 的竞态；sidebar 切换会话时通过 `setCurrentSession` 触发 `useCodexStore.loadSession`（之前这个 action 从未被调用，导致切会话不加载消息）
> - **存储扩展**：Session 新增 `deletedAt`/`forkedFrom` 字段；保持 JSON 存储（不迁 SQLite，会话量小无需）
> - **后端命令**：新增 `trash_session`/`restore_session`/`purge_session`/`fork_session`/`search_sessions`/`export_session`/`list_trashed_sessions`（7 个）
> - **搜索算法**：扫描所有未删除会话，先匹配 title（优先），再扫消息文本，生成 120 字符片段预览（⟪⟫ 标记匹配位置）
> - **Sidebar UI**：顶部搜索框（边输入边搜索，结果展示标题/内容匹配 + 片段）；hover 显示 Fork / Export(Markdown) / Rename / Trash 按钮；底部"回收站"折叠面板（带数量徽章 + 恢复/永久删除）
> - **Markdown 导出**：用结构化标题列出每条消息 + 元数据（ID/工作目录/时间/消息数）+ 角色 emoji（🤖/🛠/📝/📋/🔍/⚙️/❌）
> - **Fork 语义**：复制会话到指定消息位置（含），新会话不继承 codex thread（独立上下文），记录 `forked_from` 链路
> **未做（已列入后续任务）**：
> - SQLite 迁移（当前 JSON 足够，无需）
> - ForkDialog 让用户选从哪条消息 fork（当前直接用最后一条）
> - Export 复制到剪贴板选项（当前仅下载）

| 项 | 内容 |
|----|------|
| **描述** | 实现会话的持久化、搜索、恢复、分叉、删除 |
| **交付物** | 会话存储层 + 历史管理 UI |
| **验收标准** | 1. 所有会话自动持久化到 SQLite 2. 会话列表按时间排序 3. 全文搜索会话内容 4. 恢复历史会话 5. 从任意时间点 Fork 6. 删除（回收站）7. 重命名 8. 导出为 JSON/Markdown |
| **预估** | 2.5 天 |

### 任务 3.8：模型配置管理

> **状态：✅ 已完成（2026-09-02 收尾验收）**
> **实现摘要**：前端 `features/model/ModelSettings.tsx` + 后端 `commands/model.rs` / `services/model.rs`，已接入 Settings 面板「模型配置」tab。支持：供应商 CRUD（API Base + Key）、模型 CRUD（关联供应商 + context_window）、全局默认模型切换、推理强度（none/minimal/low/medium/high）、供应商连接测试（GET /models）、单模型对话测试（POST /chat/completions）。配置持久化到 `~/.flydex/models.json`（seed 内置 openai 等供应商）。前端 typecheck 通过、后端 cargo check 通过、命令已注册 lib.rs。
> **验收说明**：验收标准 6「会话级覆盖」未做（当前仅全局默认）；验收标准 7 写 config.toml 实为 models.json（已调整）。

| 项 | 内容 |
|----|------|
| **描述** | 实现模型管理设置页，支持多模型、多供应商、自定义模型 |
| **交付物** | 模型设置页 + 模型切换器 |
| **验收标准** | 1. 内置 OpenAI 模型列表 2. 添加自定义模型（API Base + Key + 参数）3. 多供应商支持 4. 模型测试连接 5. 推理强度调节 6. 全局默认 + 会话级覆盖 7. 配置写入 config.toml |
| **预估** | 2 天 |

### 任务 3.9：沙箱与审批策略可视化

> **状态：✅ 已完成（2026-09-02 收尾验收）**
> **实现摘要**：前端 `features/security/SettingsPanel.tsx`（「沙箱与权限」tab）+ 后端 `commands/security.rs` / `services/security.rs`，已接入 Settings 面板与 TitleBar 顶部状态指示器。支持：三档沙箱（read-only / workspace-write / danger-full-access，切换 danger 有确认弹窗）、审批策略（untrusted / on-request / never）、审批历史记录/清空。配置持久化。前端 typecheck、后端 cargo check 均通过，命令已注册 lib.rs；TitleBar 常驻显示当前沙箱+审批状态。
> **验收说明**：验收标准 2 原写「五种审批策略」，实现为 codex 合法值三档；验收标准 5「execpolicy 自定义规则」未做（后续阶段可补）。

| 项 | 内容 |
|----|------|
| **描述** | 实现沙箱模式和审批策略的可视化设置与状态显示 |
| **交付物** | 安全设置页 + 顶部状态栏指示器 |
| **验收标准** | 1. 三档沙箱切换（只读/工作区写入/完全访问）2. 五种审批策略切换 3. 切换到高风险模式时警告确认 4. 顶部状态栏始终显示当前沙箱+审批状态 5. 审批规则自定义（execpolicy）6. 审批历史记录 |
| **预估** | 2 天 |

### 任务 3.10：技术债清理——沙箱写文件普通对话化

> **状态：✅ 已完成（2026-09-02）**
> **背景**：known-issues.md 记录"codex 默认 read-only 无法写文件 / workspace-write 命令阻塞 / --approve-for-me 闪退"。经源码级核实，根因是 **exec 模式不支持交互式审批**：codex exec/src/lib.rs 对 CommandExecutionRequestApproval 与 FileChangeRequestApproval 一律直接 reject（"not supported in exec mode"），而 flydex 此前把用户配置的 `approval_policy=on-request` 透传给 exec → 写文件/执行命令的操作被 codex 直接拒绝，表现为"AI 无法写文件"。
> **修复**：
> 1. 后端 `codex_manager.rs`：exec/resume（普通对话）**强制 `approval_policy=never`**（headless 无法交互审批，on-request/untrusted 只会让操作被拒）。安全边界完全由 `sandbox_mode` 承担：read-only=只读、workspace-write=允许项目内写入、danger-full-access=不限制。Plan/Review 模式仍强制 read-only 沙箱。
> 2. 前端 `SettingsPanel.tsx`：审批策略区加说明文案（普通对话基于 headless 无法交互审批，写操作放行与否由沙箱模式决定），避免 UI 误导用户。
> 3. `work-plan.md` 任务 1.5 修正错误结论（"内部阻塞等待 y/n" → "直接拒绝"）。
> **验证**：cargo check EXIT=0；前端 typecheck EXIT=0。模型服务商 MiniMax 高负载期间无法端到端实测 AI 写文件，但 codex 源码链路（never 策略 → 无审批拦截 → workspace-write/danger-full-access 可写）已确认。默认 `security.json` 为 danger-full-access + on-request（on-request 现仅作 UI 预留，exec 下不生效）。
> **遗留**：前端 approval_request 审批卡仍为 dead code（保留为 codex 未来支持 exec 审批的兼容点）；审批历史在 exec 模式下无真实触发点。

---

## 阶段4：跨平台适配与构建

> **目标**：确保应用在 Windows 和 macOS 上均能正常运行、构建、分发  
> **预估**：8-12 天

### 任务 4.1：Windows 平台适配

> **状态：批次 A ✅ 已完成（2026-09-02），批次 B ⏳ 待做**
> **批次 A 实现摘要**（commit `e54214c` + `7e9f1c8`）：
> - **① Shell 切换**：新增 `src/services/shellService.ts`（auto 探测 pwsh→powershell→cmd，`where` 探测并缓存；显式可切 pwsh/powershell/cmd/wsl）；`terminalService` 按所选 shell 动态构造命令（pwsh/powershell `-NoLogo -NoExit -Command` utf8、cmd `/c` gbk、wsl `bash -lc`）；`TerminalPanel` 工具栏显示当前 shell + 提示符按 shell 风格；`useSettingsStore` 持久化。Settings 新增「终端与通知」tab（Shell 卡片选择）。
> - **② 系统通知**：接入 `tauri-plugin-notification`（前后端依赖 + `lib.rs` 注册）。新建 `src/services/notificationService.ts`（首次请求权限、失败静默降级）。三触发点：审批请求（默认开）、任务失败（默认开）、任务完成（默认关）。Settings「终端与通知」tab 三个开关。
> - **③ 应用内快捷键**：新建 `src/hooks/useGlobalShortcuts.ts`，`Ctrl+Shift+N` 打开终端 / `Ctrl+Shift+K` 回对话，window **捕获阶段**监听（任意焦点生效，含终端内）。⚠️ 实测修复：初版按"焦点在输入元素跳过"拦截了终端内快捷键（xterm 焦点在隐藏 textarea），改捕获阶段 + 不跳过输入元素，实机验证通过（2026-09-02）。
> - **④ 长路径/UNC**：`resolve_dir` 修复 `\\?\UNC\server\share` → `\\server\share` 前缀还原（此前只处理本地盘 `\\?\`）。⚠️ 说明：>260 字符长路径受 Windows 系统限制，canonicalize 走 `\\?\` 扩展路径可读，返回普通路径后普通 API 可能仍受限，属系统级约束（详见批次 B 遗留）。
> - **验证**：前端 tsc ✅、后端 cargo check ✅、tauri dev 自动重编译并重启、flydex.exe 稳定运行无崩溃、实机 UI 验证通过（快捷键双向、Shell 切换、通知开关）。
> - **批次 B（⏳ 待做）**：① WebView2 检测与引导（非 WebView2 运行时安装提示/引导下载）；② **全局热键**（系统级注册，应用失焦时也可唤起到前台，区别于应用内快捷键）；③ 文件对话框 Windows 原生风格；④ 评估长路径/UNC 完整支持（如需要 `\\?\` 透传或 manifest longPathAware）。

| 项 | 内容 |
|----|------|
| **描述** | 适配 Windows 平台的 Shell、路径、通知、快捷键、WebView2 |
| **交付物** | Windows 上可正常运行的应用 |
| **验收标准** | 1. ✅ 默认 PowerShell，可切换 cmd/WSL（批次A：auto 探测 + 显式切换） 2. ✅ 长路径/UNC 路径支持（批次A：UNC 前缀修复；长路径系统级约束批次B评估） 3. ✅ Windows Toast 通知（批次A：三场景+开关） 4. ⏳ 全局热键（批次B） 5. ⏳ WebView2 检测与引导（批次B） 6. ⏳ 文件对话框 Windows 风格（批次B） |
| **预估** | 3 天 |

### 任务 4.2：macOS 平台适配

| 项 | 内容 |
|----|------|
| **描述** | 适配 macOS 平台的 Shell、Universal Binary、通知、菜单栏、权限 |
| **交付物** | macOS 上可正常运行的应用 |
| **验收标准** | 1. Universal Binary（Intel + Apple Silicon）2. 默认 zsh 3. Notification Center 4. 原生菜单栏 5. 可选状态栏图标 6. TCC 权限请求（桌面/文档访问）7. 触摸板手势 |
| **预估** | 3 天 |

### 任务 4.3：自动更新机制

| 项 | 内容 |
|----|------|
| **描述** | 实现应用自动检查更新、下载、安装、回滚 |
| **交付物** | 自动更新功能 + 更新服务器配置 |
| **验收标准** | 1. 启动时检查更新 2. 每日定时检查 3. 三通道（Stable/Beta/Nightly）4. 增量更新 5. 更新失败自动回滚 6. 企业环境可禁用 |
| **预估** | 2 天 |

### 任务 4.4：安装包构建与签名

| 项 | 内容 |
|----|------|
| **描述** | 配置构建流水线，生成签名安装包 |
| **交付物** | dmg（macOS）+ msi/exe（Windows）安装包 |
| **验收标准** | 1. macOS DMG + 签名 + 公证 2. Windows MSI/EXE + Authenticode 签名 3. 一键构建命令 4. GitHub Actions CI 自动构建 |
| **预估** | 2 天 |

### 任务 4.5：性能优化

| 项 | 内容 |
|----|------|
| **描述** | 针对大项目、大文件、长会话的性能优化 |
| **交付物** | 性能优化后的应用 + 性能基准报告 |
| **验收标准** | 1. 10,000 文件项目文件树 < 500ms 2. 10,000 行 Diff < 1s 3. 冷启动 < 3s（SSD）4. 内存占用空闲 < 300MB 5. 对话滚动 60fps |
| **预估** | 2 天 |

---

## 阶段5：打磨、测试与发布准备

> **目标**：质量保障、文档完善、Beta 发布  
> **预估**：10-15 天

### 任务 5.1：端到端测试

- 核心交互流程 E2E 测试
- 单元测试覆盖关键业务逻辑
- 跨平台手动测试矩阵
- **预估**：3 天

### 任务 5.2：可访问性

- 键盘全操作支持
- 屏幕阅读器适配
- 高对比度主题
- 字体大小调节
- **预估**：2 天

### 任务 5.3：国际化（中/英）

- i18n 框架接入
- 中文 + 英文语言包
- 日期/时间/数字格式本地化
- **预估**：2 天

### 任务 5.4：崩溃恢复与数据完整性

- WAL 持久化
- 崩溃后自动恢复会话
- 文件修改回滚机制
- 数据导出/备份
- **预估**：2 天

### 任务 5.5：文档与帮助

- 用户使用文档
- 快捷键速查表
- 内置帮助面板
- 常见问题 FAQ
- **预估**：2 天

### 任务 5.6：Beta 发布

- GitHub Release 发布
- 官网下载页
- 更新日志
- 反馈收集渠道
- **预估**：2 天

---

## 风险登记册

| ID | 风险 | 影响 | 概率 | 应对策略 | 负责人 |
|----|------|------|------|----------|--------|
| R1 | codex-rs API 不稳定，直接依赖困难 | 高 | 中 | 任务 0.3 验证，备选 stdio 方案 | — |
| R2 | Tauri 2.x 某些平台 API 不完善 | 中 | 低 | 关键功能有原生 Rust 实现备选 | — |
| R3 | 大项目文件树性能问题 | 中 | 高 | 虚拟滚动 + 懒加载 + 索引 | — |
| R4 | 跨平台终端 PTY 兼容性问题 | 中 | 中 | portable-pty + 充分测试 | — |
| R5 | 流式渲染在长会话中卡顿 | 中 | 中 | 虚拟列表 + 消息分片渲染 | — |
| R6 | 沙箱实现存在逃逸漏洞 | 高 | 低 | 最小权限 + 安全审计 | — |
| R7 | 自动更新在 Windows 上权限不足 | 中 | 中 | NSIS 提权 + 备用手动更新 | — |

---

## 里程碑与交付物汇总

| 里程碑 | 时间点 | 交付物 | 验收标准 |
|--------|--------|--------|----------|
| **M0** | 阶段0结束 | 项目骨架 + Codex 集成决策 + 架构规范 | 可运行空壳 + ADR 文档 |
| **M1** | 阶段1结束 | 关键路径原型 | 完成一次真实对话全流程 |
| **M2** | 阶段2结束 | 定稿视觉风格 | 两种风格对比 + 定稿主题 |
| **M3** | 阶段3结束 | 核心功能完整版 | 9 个功能模块全部可用 |
| **M4** | 阶段4结束 | 跨平台可分发版本 | Win + Mac 安装包 + 自动更新 |
| **M5** | 阶段5结束 | Beta 发布版 | 测试通过 + 文档完善 + 公开发布 |

---

## 下一步行动

**当前待讨论任务：任务 0.1 — 项目脚手架搭建**

讨论要点：
1. 项目名称叫什么？（影响包名、应用名、目录名）
2. Tauri 2.x 还是 1.x？（建议 2.x，更成熟的插件生态）
3. 包管理器用 pnpm 还是 npm？（建议 pnpm，Codex 源码也用 pnpm）
4. 是否需要现在就配置 Git 仓库？（建议初始化 Git，配 .gitignore）

确认以上问题后，开始执行任务 0.1。

---

## 阶段6：对标 Codex/Claude Code 能力升级与自进化

> **状态**：⏳ 规划完成（2026-09-02），尚未开工
> **目标**：让 Flydex 具备 Codex / Claude Code 级别的工作能力，并实现**受控的"自进化"（能力自积累）**
> **预估**：6.1-6.5 合计约 14-17 天（按小步快跑逐个任务讨论后开工）
> **前置决策（开工前确认）**：建议**先做 6.2（自主执行）+ 6.1（上下文记忆）**——这是从"Codex 的壳"变成"能干活的工作台"的分水岭，也是自进化 L1 的地基；6.3 → 6.4 → 6.5 顺序推进。

### 6.0 现状盘点与差距分析

**已具备（✅ 交互骨架 ~65%）**：Codex Agent 驱动、流式对话、工具调用卡片、文件 diff/逐块审批、PTY 内置终端、Git 集成、代码审查 `/review`、MCP 客户端、Skills 系统、计划模式、图像附件、模型配置管理、会话历史、沙箱与审批策略、Windows 平台适配（批次A）。

**对标差距（❌ 四个深水区）**：

| 维度 | Codex / Claude Code 的做法 | Flydex 现状 | 差距 |
|------|------------------------------|-------------|------|
| 上下文与记忆 | CLAUDE.md 分层记忆（项目/用户/企业）+ 自动 compact + 记忆自动更新 | 只读单层 CLAUDE.md，无自动沉淀/压缩 | 高 |
| 自主执行 | `--full-auto` 全自动多轮 + 审批按规则放行（非每步弹窗） | 每步审批阻塞，无规则化放行 | 高 |
| 工具生态 | 20+ 内置工具（web/文件/终端）+ MCP 深度整合 + 子代理并行 | 有 MCP 接入，工具少、无子代理 | 中 |
| 可靠性 | checkpoint 恢复 + sandbox 隔离执行 + 失败重试 | 无 checkpoint、无沙箱执行、无重试 | 中 |

### 6.0.1 自进化定义（先定义，再实现）

"自进化"拆成**三层受控自积累**，越往下越安全、越容易落地：

| 层 | 内容 | 可行性 |
|----|------|--------|
| **L1 记忆层** | 项目约定 / 决策记录 / 常用命令自动写入项目记忆（类 CLAUDE.md 自动更新） | ✅ 完全可行 |
| **L2 Skill 层** | 完成任务后把经验沉淀为可复用 skill，下次按对话自动命中调用 | ✅ 完全可行（已有 Skills 骨架） |
| **L3 工具层** | Agent 通过 MCP 动态挂载/卸载工具，自我发现能力缺口 | 🟡 部分可行（MCP 接入已具备基础） |

**代码自我重写（最激进层）**：技术上 Flydex（codex 驱动）能改自己的代码，但这是"失控循环"入口。**安全边界（强制）**：
- 只能在独立"自我改进工作区"（如 `.flydex-self`）内运行，不碰主代码
- 每次变更必须过：编译门禁（tsc + cargo check）→ 测试门禁（如有）→ 人工审批
- 禁止自主推送远程；禁止绕过审批；禁止修改安全/权限相关代码
- 默认关闭，作为实验性开关（默认 `false`）

### 6.1 上下文与记忆（推荐优先）

> **状态：✅ 已完成（2026-09-02）**
> **实现摘要**：P0 分层记忆读写+注入+前端指示器（e609d2c）；P1 记忆自动沉淀闭环+记忆管理面板（ef48755）；P2 自动 compact（上下文快照+新会话）（95a9558）；merge 03bb722。

| 项 | 内容 |
|----|------|
| **描述** | 分层记忆 + 自动 compact + 记忆自动更新，解决长会话/多项目上下文丢失 |
| **交付物** | 分层记忆系统 + 上下文压缩 + 记忆自动沉淀 |
| **验收标准** | 1. 项目级记忆（`<workdir>/CLAUDE.md` 或 `.flydex/`）自动加载进 system prompt 2. 用户级记忆（`~/.flydex/`）跨项目生效 3. 长会话自动 compact（超预算时压缩历史，保留关键决策）4. 任务结束自动沉淀"决策记录/约定/踩坑"进项目记忆（需审批）5. 记忆去重与版本管理 |
| **预估** | 3 天 |
| **讨论要点** | 记忆存储格式（MD vs 结构化 JSON）；compact 触发阈值与摘要策略；自动沉淀是否需审批 |

### 6.2 自主执行（推荐优先）

| 项 | 内容 |
|----|------|
| **描述** | 审批规则化 + 全自动模式，让 Agent 在受控范围内连续执行 |
| **交付物** | 审批规则引擎 + 全自动模式（--full-auto 等价物）+ 规则可视化配置 |
| **验收标准** | 1. 审批规则可配置（按命令前缀/工具/文件路径/风险等级自动放行或拦截）2. 规则命中自动放行、不弹窗 3. 未命中规则仍逐条审批 4. 全自动模式（放行全部读写）带醒目"危险模式"提示 + 一键暂停/终止 5. 规则持久化 + 设置页可视化 6. 每次自动放行记录审计日志 |
| **预估** | 3 天 |
| **讨论要点** | 规则语法（借鉴 codex `--allowedTools` / Claude Code 权限规则）；危险操作（删文件/装依赖/推送）默认永不自动放行；审计日志 UI |
> **状态：🔨 Phase 1 完成（2026-09-03）—— app-server 通道迁移（B 方案，一次性，不留 exec）**
> **实现摘要**：
> - **通道切换（主会话 + 子代理，全部迁移，exec 不再用于 AI 会话）**：`codex_manager.rs` 的 `run_command` 由 `cmd /c codex exec --json`（PTY 流式）切换为 app-server stdio JSON-RPC；新建 `services/appserver_client.rs`（单例 daemon + 专用 writer 线程独占 stdin + 读线程事件映射 + 审批拦截）。子代理 `mcp/subagent-server.mjs` v2.0.0 同样迁移：自管理 app-server daemon + thread/start → turn/start → 等 turn/completed → **thread/delete 自动回收资源**（对齐 Claude Code 同步 subagent，独立上下文只回最终结论）。
> - **执行前审批（先判断再执行）**：app-server 的 `item/commandExecution/requestApproval` 等服务端请求在命令执行**前**到达客户端；Rust 读线程/子代理 daemon 先判定再响应 `{decision: accept|decline|...}`。已实测：read-only 沙箱下模型写文件 → 触发 requestApproval → respond accept → 命令**执行成功**（文件落盘）→ 证明审批通道真实有效（exec 模式此通道被源码直接 reject，无法拦截）。
> - **事件映射（前端零改动）**：app-server notification 由 Rust 端映射为前端已兼容的 exec 风格事件（item.type camelCase→snake_case：`agentMessage→agent_message`、`commandExecution→command_execution`、`mcpToolCall→mcp_tool_call`、`fileChange→file_change`；字段 aggregatedOutput→aggregated_output；status 透传 snake_case）。item 结构（AgentMessage.text / CommandExecution.command+aggregatedOutput+exitCode / FileUpdateChange.path+kind+diff）与 exec 一致，`useCodexSession.ts` 无需修改。
> - **协议/参数关键事实（实测固话）**：initialize 必须带 `clientInfo.version`（缺省报 -32600）；`thread/start` 的 sandbox 参数须传字符串（`'workspace-write'`），approvalPolicy=`on-request` 时模型自主决定是否请求 escalated（跨沙箱写/网络才触发审批）；审批响应 `{decision:'accept'}`；`thread/delete` 回收线程；`turn/interrupt` 优雅中断。
> - **验证**：cargo build EXIT=0；协议冒烟 3 类全通（主链路 initialize→thread→turn→completed 模型正确回复 / 子代理 MCP 层全通并返回结论 / 审批 accept 后命令执行）；文件变更字段与 exec 一致（add/delete/update）。
> - **遗留（Phase 2 待办）**：① 规则引擎（deny/allow/ask + 内置 deny 白名单）替换 Phase 1 默认 accept ② 审批 UI 真实交互（当前审批卡片为"通知性质"，approve_codex 为空操作）③ 全自动模式按需切换（`thread/settings/update` 已具备通道）④ 审计存储 ⑤ 清理 exec 残留 dead code（ActiveCodex/clean_line/portable_pty 等）与 _appserver_schema 临时目录。

> **状态：🔨 Phase 2 完成（2026-09-03）—— 规则引擎 + 审批真实交互 + 全自动 + 审计（对齐 Claude Code 权限模型）**
> **实现摘要**：
> - **规则引擎（deny/allow/ask）**：`security.rs` 新增 `SecurityService::decide(command)` —— 决策优先级 = **内置 deny 白名单 > 用户规则 deny > 用户规则 allow > 默认 ask（全自动转 allow）**，对齐 Claude Code 权限模型（deny 优先、不可逆操作默认拒绝）。内置 deny 白名单硬编码（递归删根/家目录/系统盘、磁盘格式化/分区、直接写块设备、关机重启、注册表删除等破坏性命令，用户规则不可覆盖，安全底线）。用户规则持久化 `~/.flydex/permissions.json`，新增命令 `add_permission_rule` / `remove_permission_rule` / `list_permission_rules` / `clear_permission_rules`。
> - **审批真实交互（先判断再执行）**：`appserver_client.rs` `handle_server_request` 审批分支从"默认 accept"改为规则引擎决策——deny 命中 → **执行前直接 `{decision:'decline'}`**（命令不执行）+ 审计；allow/全自动 → `accept` + 审计；**ask → 挂起**（注册 `PENDING_APPROVALS`，不 respond，daemon 挂起当前 turn 等用户）。用户在前端审批卡点允许/拒绝 → `approve_codex(approval_id,…)` → `AppServerClient::respond_approval` 回 `accept/decline`，turn 继续。前端 `approval_request` item 新增 `decision`（ask/auto_accept/auto_deny）+ `reason`：ask 弹审批卡，auto 仅消息流通知。
> - **全自动模式（按需开启）**：`approval_policy=never` 时 `decide()` 返回 `AutoAllow`（全部自动放行，等价 Claude Code skipPermissionMode），模型自主决策；用户经设置页切换，与"按需判断开启全自动"对齐。
> - **审计存储**：规则引擎自动决策（deny/allow）与用户审批响应均写入审批历史（`~/.flydex/security.json` history，保留 200 条），含命令/决策/时间/run_id。
> - **验证**：`cargo test --lib services::security` 3 单测全过（内置白名单存在性/空命令 ask/普通命令不误伤）；`cargo check` EXIT=0；前端 `tsc --noEmit` EXIT=0；dev watcher 已重编译（exe 21:35）。
> - **遗留（Phase 3 待办）**：~~① 清理 exec 残留 dead code~~ **✅ 已完成（cargo 零 warning）**；~~② 删除 _appserver_schema 与 _patch_*.py 临时目录~~ **✅ 已完成**；~~③ 规则配置可视化 UI~~ **✅ 已完成（2026-09-03，见下方补充）**；~~④ deny 命中结果卡片化展示~~ **✅ 已完成**；~~⑤ debug_log 写文件 GBK 编码修正~~ **✅ 已确认无需修改（文件本就 UTF-8，101 行中文正常；乱码仅 GBK 控制台显示层）**。

> **Phase 2 补充（2026-09-03 实测定论）—— 审批有效性的关键边界（探针实证）**
> - **沙箱 × 审批策略 × deny 有效性矩阵（`_smoke_sandbox_probe`/`_smoke_policy_probe` 实测）**：
>   | 配置 | 写命令 requestApproval | deny 可介入 | 只读命令 |
>   |---|---|---|---|
>   | read-only + on-request | ✅ 到达 | ✅ 可靠 + 沙箱兜底 | 模型自主（多数不请求） |
>   | read-only + untrusted | ✅ 到达 | ✅ 绝对 | ❌ **也请求（弹卡多）** |
>   | workspace-write + on-request | ❌ 0 次（codex 直接执行） | ❌ 完全失效 | — |
>   | workspace-write + untrusted | ✅ 到达 | ✅ 绝对 | ❌ 也请求 |
>   - **结论**：`workspace-write + on-request` 下 codex 把工作区写操作视为普通命令直接执行、不请求审批 → flydex 规则引擎（deny/allow/ask）**无法介入**，这正是"deny 拦不住"的根因；`read-only` 沙箱是最可靠兜底（模型不请求审批时沙箱也在命令执行层拒绝写入）。**推荐默认 `read-only + on-request`**（双保险 + 日常顺畅）。
> - **手工编辑 permissions.json 的 BOM 陷阱（已踩坑修复）**：PowerShell `Set-Content -Encoding UTF8`（Windows PowerShell 5.1）写入带 UTF-8 BOM → `serde_json::from_str` 解析失败被 `.ok()` 吞掉 → `load_rules()` 返回空规则 → deny 静默失效。**已用无 BOM 方式重写**；后端 `add_permission_rule`（Rust `fs::write`）无此问题。
> - **协议认知修正（重要）**：v1/v2 schema 均**无**客户端 `thread/settings/update` 方法（仅 daemon→客户端 `thread/settings/updated` 通知）。**会话中途切换沙箱/审批策略无法对已有 thread 生效**（thread/start 时固定），切设置只对新会话生效。**正确通道 = `thread/fork`**（params 支持 sandbox/approvalPolicy/approvalsReviewer/model/cwd 覆盖，保留对话上下文）——"切设置自动 fork 当前会话"列为 Phase 3 待办。
> - **规则可视化 UI 已实现（2026-09-03）**：设置页「沙箱与权限」tab 新增「权限规则」管理区（deny/allow 增删查 + 清空，前端 types/securityService/useSecurityStore/SettingsPanel 四文件），对接后端 add/remove/list/clear_permission_rule 命令；审批策略过时文案（"exec 恒为自动放行"）同步更新。已写入常用 allow 规则（git/pnpm/npm/cargo/node/python/rustc/mkdir/New-Item/Get-Content/dir/cls）。tsc EXIT=0。

> **Phase 3 收尾（2026-09-03 完成）**：
> - **exec 残留 dead code 全清（cargo 零 warning）**：删除 `codex_manager.rs` 的 `ActiveCodex`/`ACTIVE`/`active()`/`clean_line()`/`ensure_git_safe_directory`/`model_args`（exec 时代 `-c model=` 构建，app-server 用 thread/start 的 model 参数替代）+ **run_command 内 exec args 构建段**（args 变量从未被使用，实际执行已是 app-server `turn_start`；`sandbox`/`session_model` 参数保留——被 thread_start 用）；删 `appserver_client.rs` 的 `ChildStdin` import + 多余 `use debug_log`；删 5 个孤立 dead-code 文件 `types/codex_json.rs`/`types/common.rs`/`types/error.rs`/`utils/platform.rs`/`utils/path.rs`（无任何引用）+ mod 声明；3 处无谓 unsafe 块去除；`skill.rs` 死代码 `prompt`、`storage.rs` 死代码 `role`/`format_ts` 精简；`security.rs`/`model.rs` 未用方法加 `#[allow(dead_code)]`（保留给前端/单测/未来）。
> - **_appserver_schema 临时目录已删除**（含 schema 冒烟脚本；探针结论已固化到上文）。
> - **debug_log 编码**：确认文件本就是 UTF-8（101 行中文全部正常），乱码仅发生在 GBK 控制台 eprintln 显示层，无需修改。
> - **deny 命中卡片化**：前端 `CodexMessage.kind` 新增 `'deny'`，auto_deny 由系统文本改为红色盾牌卡片（命令 + 命中原因 + 时间），ChatPanel 新增渲染分支（`ShieldAlert` icon）。auto_accept 保持系统消息（低频正面事件）。

> **6.2 收尾验证（2026-09-03 GUI 实测全绿）**：
> - **deny 卡片链路完整打通**：规则 `deny test_delete` → 命令 `Out-File test_delete_check.txt` → `decision=auto_deny`（日志）→ 前端红色盾牌卡片「已自动拒绝」+ 命令 + 原因「用户规则：test_delete」→ 审计落盘 `approved=False`（history 8 条）→ 模型感知拒绝并停止。**不再弹审批卡**，实现"先判断再执行"。
> - **修复规则误填前缀 bug**：用户经 UI 添加规则时把字段前缀也填入 pattern（`pattern test_delete`），导致命令子串匹配失败退化为 ask。**前端 + 后端 `add_rule` 双保险剥离 `pattern:`/`pattern ` 前缀**；规则文件已修正为 `test_delete`（无 BOM）。
> - **诊断增强**：审批日志加入完整 command（截断 200 字符）：`approval id=... decision=... method=... command=...`，便于排查匹配问题。


### 6.3 工具生态（web 工具 + 子代理）

> **状态：✅ 已完成（2026-09-03）**
> **实现摘要**：
> - **P0 - web 检索/抓取工具 + MCP 模板市场**：`mcp/web-search-server.mjs` 提供 `web_search` + `web_fetch` 两个 MCP 工具（零依赖 node）；搜索链路确定性增强（任务前置 / 预取注入 / URL 缓存纠正 / 拼写修正重试 / 6 次搜索上限 / 高价值链接抓取建议），实测 3 轮独立 run 稳定命中真实画像零编造；`McpSettings.tsx` 模板市场支持 web-search（内置）/ GitHub / Filesystem / Playwright 一键接入，Server 可编辑/测试/删除/开关。
> - **P1 - 子代理并行执行**：前端 `SubagentPanel.tsx`（多任务并行、独立 workdir/沙箱、按 run_id 路由、空指令可见提示）；MCP `mcp/subagent-server.mjs` 提供 `spawn_subagent` 工具（主模型可自动派生子代理，独立 codex 进程、独立上下文、只回最终结论、三层截断、递归保护 FLYDEX_SUBAGENT_DEPTH、超时强杀）；搜索型子代理自动注入搜索纪律。
> - **验收对照**：① web 工具可开关 ✅ ② MCP 模板市场一键接入 ✅ ③ 子代理并行+结果汇总 ✅ ④ 权限继承/隔离可配（inherit/read-only + sandbox 参数）✅ ⑤ 工具失败降级提示（工具卡片 error 态 + 子代理失败提示 + server URL 容错）✅

| 项 | 内容 |
|----|------|
| **描述** | 补齐内置工具 + 子代理并行，扩展现有能力边界 |
| **交付物** | web 检索/抓取工具 + 子代理执行框架 |
| **验收标准** | 1. web 搜索/网页抓取工具（可开关，默认关）2. MCP Server 市场/一键接入模板 3. 子代理：可派生子任务并行执行（如多文件独立改造），结果汇总结 4. 子代理权限继承/隔离可配 5. 工具调用失败自动降级提示 |
| **预估** | 4 天 |
| **讨论要点** | 子代理基于 codex CLI 多会话并行是否现实（资源占用/密钥隔离）；web 工具走 MCP 还是内置 |

### 6.4 可靠性（checkpoint + 沙箱 + 重试）

| 项 | 内容 |
|----|------|
| **描述** | 会话 checkpoint 恢复 + 隔离执行 + 失败重试 |
| **交付物** | checkpoint 机制 + 沙箱执行 + 重试策略 |
| **验收标准** | 1. 会话中途崩溃可恢复到最近 checkpoint（消息/审批/文件状态）2. 高风险命令可切沙箱执行（如 Docker/E2B 类）3. 命令执行失败自动重试（可配次数）4. 大仓性能：10,000 文件项目文件树 < 500ms |
| **预估** | 4 天 |
| **讨论要点** | checkpoint 落盘频率与开销；沙箱实现方案（Windows 上 Docker/VM 成本高，是否降级为权限最小化）；重试哪些命令安全 |

> **6.4 ② 会话恢复（2026-09-04 已实现 + GUI 实测通过）**：探查发现**会话持久化字段名系统性不匹配 bug**——Rust 模型输出 snake_case（`thread_id`/`project_id`/`created_at`），前端 TS 读 camelCase（`threadId`/`projectId`/`createdAt`）→ `save_session` 反序列化失败 → autosave 静默失败，**消息/thread_id 从未真正持久化**（所有会话 JSON `thread_id: null`），崩溃后无法 resume codex 上下文。**修复 A（serde）**：`models/session.rs` + `models/project.rs` 加 `#[serde(rename_all = "camelCase")]` + `alias` 兼容旧 snake_case 文件（单测 2/2：旧文件 alias 读回 ✓ / 新文件 camelCase 写出 ✓）。**修复 B（前端 currentSessionId 不同步）**：autosave 读 useCodexStore.currentSessionId，但 `setCurrentProject`/`createSession` 只设 useProjectStore → codex store 恒 null → autosave 全部 skip（console `[autosave] subscribe: no currentSessionId`）。修复：两处同步 codex store + 加载消息。**GUI 实测通过**：`[autosave] saved sess_... threadId=01a06a11...` → session JSON camelCase + threadId 非 null + 消息落盘 + updatedAt 更新。诊断日志保留：前端 `[autosave]` + Rust `save_session`（flydex-appserver.log）。**崩溃恢复实测（完整闭环）**：重启 dev 后重开会话发"还记得上轮对话吗"，曾报 `thread not found`（app-server 是 Rust spawn 的子进程，重启即被杀 → thread 内存态丢失，但 rollout 磁盘持久化在 `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl`）。**修复 C（thread/resume）**：协议确认 codex `thread/resume { threadId }` 可从磁盘重新 open thread；`appserver_client.rs` 新增 `thread_resume`，`codex_manager.rs` resume 分支**先 thread/resume 再 turn/start**，失败降级 thread/start 新建并提示不保留历史。实测通过：模型回忆起上轮「ok」，threadId 保持 `01a06a11`（同 thread append），消息累积 + updatedAt 更新。

> **6.4 ③ 瞬时错误重试（2026-09-04 已实现）**：`appserver_client.rs` request 层加重试包装（MAX=3）——**瞬时错误**：`-32001 Server overloaded`（codex README 官方建议 retry + 指数退避）、明确 `retry later`、只读查询类方法（model/list、thread/list、thread/read、config/read、skills/list 等）超时；**不重试**业务失败（thread not found / 审批拒绝 / 参数错误）。指数退避 300/600/1200ms + jitter，日志 `[flydex-appserver] retry ...`。错误信息带 `code=`/`message=` 便于识别。cargo check EXIT=0。

> **6.4 ④ 大仓文件树性能（2026-09-04 已实现 + 性能实测达标）**：验收"10,000 文件项目文件树 < 500ms"。**性能基线实测**（造 10,000 文件测试仓）：单层 listdir **0.3ms**、listdir+classify 1.5ms、**递归全扫 os.walk 36ms**、git status 135ms——后端扫描全部 < 500ms（13 倍余量），瓶颈在**前端一次渲染 10k 节点**而非扫描。**实现**：后端 `list_directory` 命令（`commands/workspace.rs`，单层扫描 + has_children peek + 隐藏项跳过 + 排序）；前端 `FilesView`（懒加载 + 已加载层缓存 + 大目录保护 MAX_VISIBLE_FILES=300 防卡顿）+ Sidebar「Files」入口 + 路由。验证：cargo check / eslint / tsc 全绿。**GUI 实测通过（2026-09-04）**：重启 dev 后 Files 视图正常加载工作区文件树，点击目录懒加载展开无卡顿。

对齐 Claude Code 的"每轮自动 commit 快照"→ 每轮 `turn/completed` 后对工作区 `git add -A && git commit`（本地，不 push）。新增 `src-tauri/src/services/git_checkpoint.rs`：`checkpoint_workspace(cwd)` 开关（`~/.flydex/security.json` 的 `auto_checkpoint`，serde default true，兼容旧文件）+ 非 git 仓库/无变更/失败静默跳过 + 独立线程不阻塞 reader。接入：`appserver_client.rs` 静态 `THREAD_CWD`（thread_start 写入 cwd，turn/completed 读后 spawn 线程执行）。**单测 2/2 通过**（有变更提交 + 无变更跳过 / 非 git 跳过）。cargo check EXIT=0。**前端开关 UI 已补**：设置页「自动 git 快照」Toggle（`set_auto_checkpoint` 命令 + store + service）。**GUI 实测通过（2026-09-03）**：在 `C:\llm\glass`（git 仓库）让模型创建 `checkpoint_probe.txt` → turn 完成自动产生 `flydex-checkpoint 1788484335212` commit，文件已提交、工作区干净。快照日志已升级写 `logs/flydex-appserver.log`（`[flydex] git checkpoint cwd=... msg=...`）。

### 6.5 自进化闭环（skill 自动沉淀 + 记忆自动更新 + 配置反馈优化）✅ 已完成（2026-09-04）

| 项 | 内容 |
|----|------|
| **描述** | 打通 L1/L2/L3，形成"执行 → 沉淀 → 复用"闭环 |
| **交付物** | skill 自动沉淀管线 + 记忆自动更新 + 配置反馈优化 |
| **验收标准** | 1. 任务完成后可一键/自动把"解决方案+踩坑"沉淀为 skill（带校验：可复现性检查）2. 沉淀的 skill 后续对话自动命中 3. 项目记忆自动更新（见 6.1）4. 基于执行结果反馈（成功率/耗时）自动调优系统提示词参数（需评估器闭环）5. 所有自动动作有审计 + 可回滚 |
| **预估** | 4 天（依赖 6.1/6.2 闭环） |
| **讨论要点** | 自动沉淀的触发时机与校验门禁；skill 质量评估（避免垃圾 skill 污染）；"代码自我重写"实验开关是否纳入本任务 |

> **6.5 自进化闭环（2026-09-04 开工，已对齐收敛）**：方向对齐 Claude Code + 用户拍板——**显式确认沉淀**（一键触发 + 校验门禁），**不做全自动管线**（不自动调优 system prompt，安全边界要求默认关闭）。范围收敛：① **skill 沉淀**：任务完成后一键触发 + 可复现性校验（SKILL.md 含可复现步骤）+ 显式确认入库，进 `.codex/skills/` 供后续自动命中；② **记忆显式更新**：任务完成后一键把"方案+踩坑"写入项目记忆（复用 6.1 memory.rs append_project_memory）；③ **配置反馈优化默认关闭**：留接口（成功率/耗时统计），不做自动调优。安全：所有自动动作写审计日志 + 可回滚（skill 入库/记忆写入均记录并可撤销）。

> **6.5 skill 沉淀闭环（2026-09-04 已完成 + GUI 实测通过）**：后端 `services/skill.rs` 新增 `skill_validate`（校验门禁：frontmatter 必须含合法 name/description + 正文非空 >= 50 字符 + 可复现结构启发式）+ `create_skill`（校验通过才入库，写 `.codex/skills/<name>/SKILL.md`，同名先备份旧版到 `logs/skill-trash/`）+ `delete_skill`（先备份可回滚）；commands/skill.rs + lib.rs 注册 `skill_validate/skill_create/skill_delete`；单测 5/5。前端 `SkillSettings` 重写：新建技能表单（模板/校验/保存）+ 项目技能删除（回滚）+ 沉淀到项目记忆（复用 memoryService.appendProject）。沉淀的 skill 走 `.codex/skills/` 供 codex 自动命中（同 web-search 机制）；配置反馈优化默认关闭（不自动调优 system prompt）。**GUI 实测（cwd=C:\llm\jint）**：create → delete（备份到 skill-trash）→ 再 create 全链路通过；备份内容与 SKILL.md 完全一致（equal=True）；审计日志 `[flydex] skill create/delete/create` 3 条完整记录；沉淀记忆写入 `jint/.flydex/MEMORY.md` 含 [my-skill] skills 段。

> **6.5 记忆 section 去重/合并（2026-09-04 已完成 + GUI 实测通过）**：`memory.rs` append_memory 从"纯追加"改为 `upsert_section`——按 `## <section>` 解析、同名 section 聚合收敛（历史重复段合并为一个）、段内行级去重（同名 section 共享去重集合跨段收敛）、新内容已存在则跳过写入（`dup=true`，审计日志新增 dup 字段可追溯）。**GUI 实测（jint）**：MEMORY.md 从 3 个重复 skills 段收敛为 1 段 1 行；用户再沉淀 3 次全部 `dup:true` 跳过，零新增冗余。单测 5/5（新段/同段追加/重复跳过/历史重复段收敛/多 section 保留）。

---

### 安全边界（阶段6 全局强制）

1. **全自动 ≠ 无管控**：全自动模式必须有一键暂停/终止 + 危险操作白名单外永不自动放行
2. **自进化 ≠ 自我重写**：默认只做 L1/L2/L3 受控自积累；代码自我重写仅限独立工作区 + 编译/测试门禁 + 人工审批，默认关闭
3. **所有自动动作可审计可回滚**：审批放行、记忆沉淀、skill 入库、工具挂载均记录日志
4. **密钥与权限隔离**：子代理/沙箱执行不得泄露 API Key 与工作区外文件

### 建议执行顺序

```
开工前讨论 → 6.2 自主执行（体验分水岭）→ 6.1 上下文记忆（自进化地基）
→ 6.3 工具生态 → 6.4 可靠性 → 6.5 自进化闭环
```

每个任务按工作原则第 6 条：从 master 切独立分支（`feat/6.x-<name>`），完成并验证后合并回 master 再推送。

---

*文档结束*
