#!/usr/bin/env node
/**
 * flydex 子代理 MCP server (stdio)
 *
 * 提供 spawn_subagent 工具：连接一个独立的 codex app-server daemon，
 * 创建隔离 thread 执行子任务，只把"最终结论"作为 tool_result 返回给主会话
 * （对齐 Claude Code 同步 subagent 的通道）。
 *
 * 6.2 迁移（对齐 Claude Code）：
 *  - 通道：tool_result 回填 —— 子代理的最终回答 = 本工具的返回值，codex 自动喂回父模型
 *  - 上下文隔离：子代理是独立 thread（独立上下文），中间过程全部丢弃，不占父上下文
 *  - 生命周期：thread/start → turn/start → 等 turn/completed → thread/delete 回收资源
 *    （"在需要的时候增加子任务，拿到结果后自动删除子任务"）
 *  - 审批：子代理无审批 UI，requestApproval 到达时自动 accept（受 sandbox 硬约束保护）
 *  - 截断：只回最终结论 → 30K 字符上限 → >100K 字符(≈25K token)落盘 + 2KB 预览
 *  - 递归保护：FLYDEX_SUBAGENT_DEPTH>=1 时不再暴露本工具（子代理无法再派生子代理）
 *
 * 零依赖（Node >= 18），遵循 MCP stdio 协议（JSON Lines over stdin/stdout）
 */
import readline from 'readline';
import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const SERVER_NAME = 'flydex-subagent';
const VERSION = '2.0.0';
const PROTOCOL_VERSION = '2024-11-05';

// ── 截断策略（对齐 Claude Code 标准）──
const MAX_CHARS = 30000; // 主截断：后台 subagent 结果默认 30K 字符
const LARGE_CHARS = 100000; // 大结果落盘阈值：≈25K token（中英混合取保守值）
const PREVIEW_CHARS = 2048; // 落盘后返回的 2KB 预览
const DEFAULT_TIMEOUT = 600; // 默认超时秒数（对齐 flydex 后端 600s）
const MIN_TIMEOUT = 30;
const MAX_TIMEOUT = 1800;
const MAX_PROMPT_LEN = 30000; // prompt 过长报错，避免上下文爆炸

// ── 搜索纪律：自动注入到"联网搜索型"子代理的 prompt（对齐 web-search 技能纪律）──
// 当子代理 prompt 命中搜索意图词时追加，确保搜索深度（次数/抓详情页/不编造），
// 不依赖主模型是否记得在 prompt 里写全。
const SEARCH_INTENT_RE =
  /搜索|搜一下|搜一搜|查找|查询|检索|调查|背景资料|人物信息|搜\b|search|look\s*up|\bfind\b|research/i;
const SEARCH_DISCIPLINE =
  '\n\n【搜索纪律·由 flydex 子代理服务自动注入】本子任务需要联网搜索，请严格执行：\n' +
  '1) 搜索 4~6 次：中英文名各至少一次；只用人名/主体本身作主关键词（英文名必须用裸名 名+姓，如 "Jingtian Wu"，严禁堆叠机构/院校名如 "Jingtian Wu Cornell"——实测会被同名干扰污染，裸名才能命中真实个人主页），严禁编造身份属性（职业/学校/专业/奖项/地区等）；\n' +
  '2) 连续 3 次无关键信息必须换更宽泛或另一种语言的关键词，不要用同一思路无限重试；\n' +
  '3) 必要时用 web_fetch 抓取关键链接（百科/新闻/个人主页）的完整正文，以获取毕业年份、学校、专业等细节；web_fetch 的 url 参数必须直接从搜索结果中复制原始链接，严禁手动重新输入或拼写 URL（手打极易拼错导致抓取失败）；\n' +
  '4) 只输出最终结论，不要复述中间搜索过程；\n' +
  '5) 搜索结果未覆盖的信息，如实写"未找到公开信息"，严禁编造或补全。\n' +
  '6) 当多个搜索结果出现同名人物时，主动交叉比对关键属性（时间线/学校/专业/地域/成就）确认是否同一人，不要轻易判定"同名不同人"。';

// ── 递归保护：当前进程是"子代理内的 MCP server"时（深度>=1），不再暴露 spawn_subagent ──
const SUBAGENT_DEPTH = Number.parseInt(process.env.FLYDEX_SUBAGENT_DEPTH || '0', 10) || 0;
const CAN_SPAWN = SUBAGENT_DEPTH < 1;

/**
 * 解析 codex 真实入口（npm 全局安装的 @openai/codex 的 bin/codex.js）。
 * 找到后直接 spawn node <entry>，数组参数不经 shell，prompt 内特殊字符绝对安全。
 * 找不到则回退 cmd /c codex（此时 prompt 仍走 cmd，仅作防御）。
 */
function resolveCodexEntry() {
  const roots = [process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    candidates.push(
      path.join(root, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
      path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    );
  }
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}
const CODEX_ENTRY = resolveCodexEntry();

// ══════════════════════════════════════════════════════════════════════
// app-server JSON-RPC 客户端（子代理专用，进程级单例 daemon）
// ══════════════════════════════════════════════════════════════════════
const pending = new Map(); // id -> {resolve, reject}
const turnListeners = new Set(); // { onAgentText, onError, onTurnCompleted }
let daemon = null;
let initPromise = null;
let nextId = 1;

function spawnDaemon() {
  if (daemon && !daemon.killed) return daemon;
  if (!CODEX_ENTRY) throw new Error('未找到 codex 入口，无法启动 app-server');
  const env = { ...process.env, FLYDEX_SUBAGENT_DEPTH: String(SUBAGENT_DEPTH + 1) };
  const child = spawn(process.execPath, [CODEX_ENTRY, 'app-server', '--listen', 'stdio://'], {
    cwd: process.cwd(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    handleDaemonMessage(msg);
  });
  // 必须持续读取 stderr，否则管道缓冲填满会阻塞 daemon 处理 turn 消息
  child.stderr.on('data', (d) => {
    process.stderr.write(`[subagent-appserver] ${d}`);
  });
  child.on('close', () => {
    for (const [, p] of pending) p.reject(new Error('子代理 app-server 已退出'));
    pending.clear();
    turnListeners.clear();
  });
  child.on('error', () => {
    /* close 会兜底 */
  });
  daemon = { child, rl, killed: false };

  // initialize 握手（app-server 要求 clientInfo.version；完成后发 initialized 通知）
  const rid = nextId++;
  const initParams = {
    clientInfo: { name: SERVER_NAME, title: null, version: VERSION },
    capabilities: { experimentalApi: true },
  };
  child.stdin.write(JSON.stringify({ id: rid, method: 'initialize', params: initParams }) + '\n');
  initPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('子代理 app-server initialize 超时')), 15000);
    pending.set(rid, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
      method: 'initialize',
    });
  });
  initPromise
    .then(() => {
      if (!daemon || daemon.killed) return;
      daemon.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    })
    .catch(() => {
      /* 调用方会收到 initialize 错误 */
    });
  return daemon;
}

function killDaemon() {
  if (!daemon || daemon.killed) return;
  daemon.killed = true;
  try {
    spawnSync('taskkill', ['/PID', String(daemon.child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
}

async function daemonRequest(method, params, timeoutMs = 30000) {
  const d = spawnDaemon();
  await (initPromise || Promise.resolve()).catch(() => {});
  if (daemon.killed) throw new Error('子代理 app-server 已退出');
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} 超时(${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
      method,
    });
    d.child.stdin.write(JSON.stringify({ id, method, params: params || {} }) + '\n');
  });
}

function daemonNotify(method, params) {
  const d = spawnDaemon();
  d.child.stdin.write(JSON.stringify({ method, params: params || {} }) + '\n');
}

function daemonRespond(id, result) {
  const d = spawnDaemon();
  d.child.stdin.write(JSON.stringify({ id, result }) + '\n');
}

function handleDaemonMessage(msg) {
  // Response
  if (msg.id != null && !msg.method && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(typeof msg.error === 'string' ? msg.error : JSON.stringify(msg.error)));
    else p.resolve(msg.result);
    return;
  }
  // ServerRequest（需响应）
  if (msg.id != null && msg.method) {
    if (/requestApproval|Approval/.test(msg.method)) {
      // 子代理无审批 UI：自动 accept（受 sandbox 硬约束保护：read-only 下写操作会被 OS/沙箱拒绝）
      daemonRespond(msg.id, { decision: 'accept' });
      return;
    }
    daemonRespond(msg.id, null);
    return;
  }
  // Notification
  if (!msg.method) return;
  const params = msg.params || {};
  if (msg.method === 'item/completed' && params.item) {
    const it = params.item;
    // app-server 的 item.type 是 camelCase：agentMessage / commandExecution / ...
    if (it.type === 'agentMessage' && typeof it.text === 'string') {
      for (const l of turnListeners) l.onAgentText(it.text);
    } else if (it.type === 'error' && it.message) {
      for (const l of turnListeners) l.onError(it.message);
    }
  } else if (msg.method === 'turn/completed') {
    for (const l of turnListeners) l.onTurnCompleted();
  }
}

/**
 * 运行子代理 turn（app-server）：
 *  thread/start → turn/start → 等 turn/completed → thread/delete（回收资源）
 * 返回：{ lastAgentText, errors[], ok, timeout }
 */
function runSubagentTurn(prompt, sandbox, workdir, maxWaitSec) {
  return new Promise((resolve) => {
    let settled = false;
    let lastAgentText = '';
    const errors = [];
    let timedOut = false;
    let timer = null;
    const listener = {
      onAgentText(t) {
        lastAgentText = t;
      },
      onError(m) {
        errors.push(m);
      },
      onTurnCompleted() {},
    };
    turnListeners.add(listener);
    const cleanup = () => {
      turnListeners.delete(listener);
      if (timer) clearTimeout(timer);
    };
    const done = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(payload);
    };

    (async () => {
      let threadId = null;
      try {
        // 1. 创建隔离会话（独立上下文；子代理无审批 UI → on-request + 自动 accept）
        const thread = await daemonRequest(
          'thread/start',
          {
            cwd: workdir,
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
            sandbox,
          },
          90000
        );
        threadId = thread.thread.id;

        // 2. 发送任务
        const turn = await daemonRequest(
          'turn/start',
          {
            threadId,
            input: [{ type: 'text', text: prompt }],
          },
          90000
        );
        const turnId = turn.turn.id;

        // 3. 等 turn/completed（超时则中断 + 删线程）
        await new Promise((r) => {
          const orig = listener.onTurnCompleted;
          listener.onTurnCompleted = () => {
            orig();
            r();
          };
          timer = setTimeout(() => {
            timedOut = true;
            r();
          }, maxWaitSec * 1000);
        });

        if (timedOut) {
          try {
            await daemonRequest('turn/interrupt', { threadId, turnId }, 15000);
          } catch {
            /* ignore */
          }
        }

        // 4. 回收资源：删除线程（拿到结果后自动删除子任务）
        try {
          await daemonRequest('thread/delete', { threadId }, 15000);
          threadId = null;
        } catch {
          /* ignore */
        }

        done({ lastAgentText, errors, ok: true, timeout: timedOut });
      } catch (err) {
        if (threadId) {
          try {
            await daemonRequest('thread/delete', { threadId }, 15000);
          } catch {
            /* ignore */
          }
        }
        done({ lastAgentText, errors: [...errors, err.message], ok: false, timeout: false });
      }
    })();
  });
}

/** Windows 进程树强杀（daemon 兜底） */
function killTree(pid) {
  if (!pid) return;
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* ignore */
  }
}

/**
 * 截断策略（对齐 Claude Code）：
 *  ① 只回最终结论（已在收集层完成）
 *  ② ≤30K 字符直接返回
 *  ③ >100K 字符（≈25K token）：全文落盘 .flydex-subagent/<taskId>.txt，只回 2KB 预览 + 文件路径
 *  ④ 中间档（30K~100K）：截断到 30K，标注已截断
 */
export function truncateResult(text, workdir, taskId) {
  if (text.length <= MAX_CHARS) {
    return { text };
  }
  if (text.length > LARGE_CHARS) {
    try {
      const dir = path.join(workdir, '.flydex-subagent');
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${taskId}.txt`);
      writeFileSync(file, text, 'utf8');
      const preview = text.slice(0, PREVIEW_CHARS);
      return {
        text:
          `${preview}\n\n` +
          `…（完整结果共 ${text.length} 字符，已持久化到文件: ${file}。` +
          `如需完整内容，请用读取文件工具读取该路径。）`,
      };
    } catch (err) {
      return { text: text.slice(0, MAX_CHARS) + `\n\n…（结果过长已截断；落盘失败: ${err.message}）` };
    }
  }
  return { text: text.slice(0, MAX_CHARS) + '\n\n…（结果过长，已截断到前 30000 字符）' };
}

/** 执行 spawn_subagent：app-server 子代理 → 等完成 → 回收线程 → 截断 → 返回结论 */
async function spawnSubagent(args) {
  const prompt = String((args && args.prompt) || '').trim();
  if (!prompt) {
    return { text: 'prompt 不能为空：请给子代理一个自包含的任务指令。', isError: true };
  }
  if (prompt.length > MAX_PROMPT_LEN) {
    return { text: `prompt 过长（${prompt.length} 字符，上限 ${MAX_PROMPT_LEN}），请精简指令。`, isError: true };
  }
  // 搜索型子代理：命中搜索意图词时自动注入搜索纪律，保证搜索深度（次数/抓详情页/不编造）
  let effectivePrompt = prompt;
  if (SEARCH_INTENT_RE.test(prompt)) {
    effectivePrompt = prompt + SEARCH_DISCIPLINE;
    if (effectivePrompt.length > MAX_PROMPT_LEN) {
      effectivePrompt = prompt; // 注入后超长则退回原始 prompt（纪律块约 500 字符，几乎不会触发）
    }
  }
  const sandbox = ['read-only', 'workspace-write', 'danger-full-access'].includes(args && args.sandbox)
    ? args.sandbox
    : 'read-only';
  const maxWait = Math.min(Math.max(Number((args && args.max_wait_sec) || DEFAULT_TIMEOUT), MIN_TIMEOUT), MAX_TIMEOUT);
  const workdir = String((args && args.workdir) || '').trim() || process.cwd();
  const taskId = `sa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  let result;
  try {
    result = await runSubagentTurn(effectivePrompt, sandbox, workdir, maxWait);
  } catch (err) {
    return { text: `子代理执行异常: ${err.message}`, isError: true };
  }

  if (result.timeout) {
    const reason = result.errors.filter(Boolean).join('；') || '(无输出)';
    return {
      text: `子代理超时（超过 ${maxWait}s，已中断并回收会话）。${reason ? `子进程输出: ${reason}` : ''}`,
      isError: true,
    };
  }
  if (result.lastAgentText && result.lastAgentText.trim()) {
    return truncateResult(result.lastAgentText, workdir, taskId);
  }
  // 无最终结论：给出错误原因
  const reason =
    result.errors.filter(Boolean).join('；') || '(无最终结论且无错误输出)';
  return { text: `子代理未能产生最终结论。原因: ${reason}`, isError: true };
}

/** spawn_subagent 工具定义（仅深度 0 暴露） */
const SPAWN_SUBAGENT_TOOL = {
  name: 'spawn_subagent',
  description:
    '启动一个独立的子代理（独立的 codex 会话）执行一个子任务，返回精炼的最终结论。\n' +
    '【何时使用】当任务需要拆分成独立子任务、且子任务会产生大量中间过程（多次搜索、读文件、思考）占用主上下文时，委派给子代理。' +
    '子代理拥有独立上下文，中间过程全部丢弃，只把最终结论返回给你，不污染你的上下文。' +
    '子代理完成时其会话自动回收（资源随任务释放）。\n' +
    '【用法】把子任务写成完整、自包含的指令（prompt），子代理在独立沙箱中执行。' +
    '本工具是同步的：调用后会阻塞等待子代理完成再返回，一次处理一个子任务。\n' +
    '【关键要求】在 prompt 中明确要求子代理"只输出最终结论，不要复述中间过程"，' +
    '并给出足够上下文，让子代理无需向你追问。\n' +
    '【搜索型子代理】当子任务需要联网查资料时，在 prompt 里写明搜索纪律（服务端也会自动注入）：' +
    '搜索 4~6 次、中英文名各至少一次、只用人名/主体本身作主关键词且严禁编造身份属性、' +
    '连续 3 次无关键信息必须换词、必要时用 web_fetch 抓取关键链接（百科/新闻/个人主页）完整正文、' +
    '未覆盖的信息如实写"未找到公开信息"、同名人物交叉比对属性确认是否为同一人。\n' +
    '【沙箱】默认 read-only（子代理只读文件 + 联网搜索，不能修改文件）。需要子代理修改文件时传 sandbox="workspace-write"。',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '子代理要执行的自包含任务指令（要求其只输出最终结论）' },
      sandbox: {
        type: 'string',
        description: '子代理沙箱模式：read-only（默认，只读+搜索）/ workspace-write（可改工作目录文件）/ danger-full-access',
      },
      workdir: { type: 'string', description: '子代理工作目录（默认继承主会话工作目录）' },
      max_wait_sec: { type: 'number', description: '超时秒数，默认 600，范围 30~1800' },
    },
    required: ['prompt'],
  },
  // 会启动子进程并可能写文件，非只读；审批由 default_tools_approval_mode="approve" 放行
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
};

/** JSON-RPC 响应写 stdout */
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

/** 处理 JSON-RPC 请求 */
async function handleMessage(msg) {
  const { id, method, params } = msg;
  if (!method) return; // 响应消息，忽略
  switch (method) {
    case 'initialize':
      respond(id, {
        protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: VERSION },
      });
      break;
    case 'notifications/initialized':
      // 通知，无 id，无需响应
      break;
    case 'ping':
      respond(id, {});
      break;
    case 'tools/list':
      // 递归保护：子代理内（深度>=1）不暴露 spawn_subagent
      respond(id, { tools: CAN_SPAWN ? [SPAWN_SUBAGENT_TOOL] : [] });
      break;
    case 'tools/call': {
      const { name, arguments: args } = params || {};
      if (name === 'spawn_subagent') {
        if (!CAN_SPAWN) {
          respond(id, { content: [{ type: 'text', text: '子代理不允许再派生子代理（递归保护）' }], isError: true });
          break;
        }
        const out = await spawnSubagent(args);
        respond(id, { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) });
      } else {
        respond(id, { content: [{ type: 'text', text: `未知工具: ${name}` }], isError: true });
      }
      break;
    }
    default:
      // 未知方法，返回空结果避免 codex 挂起
      respond(id, {});
  }
}

/** 主循环：逐行读 stdin，处理 JSON-RPC */
function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    try {
      await handleMessage(msg);
    } catch (err) {
      if (msg && msg.id != null) {
        respond(msg.id, { content: [{ type: 'text', text: `内部错误: ${err.message}` }], isError: true });
      }
    }
  });
  rl.on('close', () => {
    killDaemon();
    process.exit(0);
  });
}

// 仅直接运行时启动 MCP 主循环（被 import 时只暴露函数，便于测试）
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
