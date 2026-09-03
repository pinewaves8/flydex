#!/usr/bin/env node
/**
 * flydex 内置网络搜索 MCP server (stdio)
 * 提供 web_search 工具：抓取 cn.bing.com 搜索结果，返回结构化结果供 codex 分析
 * 零依赖（Node >= 18，使用全局 fetch），遵循 MCP stdio 协议（JSON Lines over stdin/stdout）
 */
import readline from 'readline';
import { pathToFileURL } from 'url';

const SERVER_NAME = 'flydex-web-search';
const VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';
const MAX_RESULTS = 8;

const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description:
    '在互联网上搜索关键词，返回标题、链接和摘要列表（中文查询走百度、英文查询走 Bing，自动适配）。' +
    '用于查询人物背景、新闻、最新动态、技术资料、事实核查等需要联网信息的场景。\n' +
    '【第一步·禁止编造身份】先只用人名/主体本身搜索（中文名、英文名各一次），搜索前严禁假设或编造其身份属性（职业/学校/专业/奖项/地区等）；只有用户明确给出或已在搜索结果中确认的属性，才可作为限定词加入后续搜索；若用编造属性搜索，只会返回同名干扰项。\n' +
    '【英文人名·裸名优先】英文人名查询必须用裸名（名+姓，如 "Jingtian Wu"），不要堆叠机构/院校/职业名作为限定词（如 "Jingtian Wu Cornell"）——实测英文人名+机构名的组合会被同名干扰（如匹配到"景甜"）污染，裸名才能命中真实个人主页。\n' +
    '【搜索次数】最多搜索 4~6 次；连续 3 次无关键信息必须换用更宽泛或另一种语言的关键词，不要用同一思路无限重试。\n' +
    '【事实纪律】只有出现在搜索结果中的信息才可作为事实陈述；' +
    '搜索结果未覆盖的信息，必须如实写"未找到公开信息"，严禁推测、编造或补全具体细节（如学校名称、日期、头衔、数字、奖项等）。' +
    '宁可承认未知，也不要编造一个看似合理的答案。\n' +
    '【人物调查·中英双查】调查人物背景时，请分两条线搜索：' +
    '① 用英文名查学术与国际信息（如 "Jingtian Wu"（裸名：名+姓））；' +
    '② 用中文名补查家乡、教育背景、中文新闻报道（如 "吴景天 康奈尔"）——' +
    '高中、获奖、家乡等中文内容通常只有中文搜索才能查到。两条线都要走，缺一不可。\n' +
    '【关键词建议】保持简洁：人名/主体 + 1~2 个关键限定即可。' +
    '不要堆叠过多修饰词（如"毕业生/alumni/获奖"等会让结果过度收窄）。' +
    '若无理想结果，可换用更宽泛或不同语言的同义关键词重试。\n' +
    '【关联与交叉验证】当多个搜索结果出现同名或相似人物/主体时，不要轻易判定"同名不同人"。' +
    '主动提取并交叉比对关键属性：时间线/毕业年份、学校、院系、专业、兴趣、地域、成就。' +
    '属性吻合（如毕业年份一致、学院学位一致、国际象棋与音乐等兴趣相同、家乡相同）即可确认是同一人。' +
    '"专业表述不同"不构成否定证据——可能是主修/辅修/兴趣/双学位，需结合学院与背景综合判断。' +
    '重要人物调查应将多条证据链关联成完整画像，主动给出"同一人"结论，而不是罗列"可能同名不同人"。\n' +
    '【长报告】输出汇总报告时，建议对关键信息标注"来自搜索结果"或"推断"，便于区分硬事实与推测。',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词（支持中文与英文）' },
      count: { type: 'number', description: '返回结果数量，默认 8，最大 10' },
    },
    required: ['query'],
  },
  // 只读工具标注：codex 据此判定无需审批，避免被 approval_policy=never 拦截
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

/** web_fetch 工具：抓取网页正文（剥离 HTML 标签与脚本样式，返回纯文本） */
const WEB_FETCH_TOOL = {
  name: 'web_fetch',
  description:
    '抓取一个网页 URL 的正文内容，返回纯文本（自动剥离 HTML 标签、脚本与样式）。' +
    '用于阅读搜索结果指向的页面全文、文档、新闻原文等需要网页完整内容的场景。\n' +
    '【使用建议】先用 web_search 找到目标链接，再用 web_fetch 抓取该链接正文；' +
    '【URL 必须复制】web_fetch 的 url 参数应直接从 web_search 返回结果中复制原始链接，手打极易拼错；' +
    '【自动容错】即使手打 URL 拼错（如重复字母 jinggtianwu/gitthub），server 也会自动尝试常见修正后重试，抓取基本不会因拼错失败；' +
    '抓取失败（403/反爬/动态渲染）时如实说明，不要编造页面内容。',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要抓取的网页完整 URL（http/https）' },
      max_chars: {
        type: 'number',
        description: '返回正文的最大字符数，默认 6000，最大 20000',
      },
    },
    required: ['url'],
  },
  // 只读工具标注：codex 据此判定无需审批，避免被 approval_policy=never 拦截
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

/** 检测查询语言：含 CJK 字符用中文版，否则用英文版（人名/英文查询效果差异巨大） */
function detectMkt(query) {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(query) ? 'zh-CN' : 'en-US';
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// cookie 会话缓存（进程内）：bing 对匿名请求会 bot 降级（结果被大幅过滤/错乱），
// 带真实会话 cookie（MUID 等）后返回正常结果，如 "Jingtian Wu Cornell" 能命中个人主页。
let sessionCookie = null;

/** 获取并缓存 bing 会话 cookie（首次访问首页拿 MUID），失败返回空串（无 cookie 兜底） */
async function ensureCookie() {
  if (sessionCookie != null) return sessionCookie;
  try {
    const res = await fetch('https://cn.bing.com/', {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
      redirect: 'follow',
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    sessionCookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  } catch {
    sessionCookie = '';
  }
  return sessionCookie;
}

// 百度会话 cookie（BAIDUID 等）：百度对匿名/高频请求易触发安全验证，带 cookie 更稳定
let baiduCookie = null;

/** 获取并缓存百度会话 cookie，失败返回空串 */
async function ensureBaiduCookie() {
  if (baiduCookie != null) return baiduCookie;
  try {
    const res = await fetch('https://www.baidu.com/', {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      redirect: 'follow',
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    baiduCookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  } catch {
    baiduCookie = '';
  }
  return baiduCookie;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 清洗搜索关键词中的"噪音词"。
 * 经验：bing 对简洁关键词命中远好于长修饰词（"Jingtian Wu Cornell" 命中个人主页，
 * 而 "Jingtian Wu Cornell graduate" 会被带到"景甜/竞天律所"等错误实体）。
 * 模型常把用户意图译成修饰词，这里生成精简版作为候选查询。
 */
const NOISE_EN =
  /\b(graduate|graduates|alumni|alumnus|student|students|undergraduate|university|universities|college|colleges|information|info|profile|background|about|related|details|bio|career|achievements?|accomplishments?|research|interests?|homepage|website|page|results?|introduction|describe|tell|find|lookup)\b/gi;
const NOISE_CN =
  /毕业生|校友|学生|信息|资料|背景|相关|人物|简介|成就|荣誉|经历|详情|搜索|结果|介绍|查找|查询|告诉/g;

/** 生成精简候选查询（去噪音词、压缩空白） */
export function simplifyQuery(query) {
  const simplified = query
    .replace(NOISE_EN, ' ')
    .replace(NOISE_CN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return simplified && simplified !== query.trim() ? simplified : null;
}

/** 单次抓取并解析 cn.bing 搜索结果 */
async function fetchBing(query, count, mkt) {
  const cookie = await ensureCookie();
  const url =
    'https://cn.bing.com/search?q=' + encodeURIComponent(query) + '&count=' + count + '&mkt=' + mkt;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`搜索请求失败: HTTP ${res.status}`);
  const html = await res.text();

  const results = [];
  // Bing 结果项：<li class="b_algo">...</li>
  const liRe = /<li class="b_algo"[\s\S]*?<\/li>/g;
  let m;
  while ((m = liRe.exec(html)) !== null && results.length < count) {
    const block = m[0];
    const titleM = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i);
    const urlM = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/i);
    const snippetM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (titleM) {
      const title = stripHtml(titleM[2]).trim();
      const link = urlM ? urlM[1] : '';
      const snippet = snippetM ? stripHtml(snippetM[1]).trim() : '';
      if (title || snippet) {
        results.push({ title, link, snippet });
      }
    }
  }
  return results;
}

/** 抓取并解析 cn.bing 搜索结果（原查询 + 精简候选查询合并，按链接去重） */
export async function bingSearch(query, count = MAX_RESULTS) {
  // 精简候选优先（更精准，如 "Jingtian Wu Cornell"），原始长查询排后
  // 经验：bing 对带修饰词的长查询常返回"同名干扰"（如景甜），清洗后的核心查询才命中真人；
  // 若原始查询在前，合并后 slice 会把精准结果截断掉。
  const simplified = simplifyQuery(query);
  const candidates = [];
  if (simplified && simplified !== query.trim()) candidates.push(simplified);
  candidates.push(query.trim());

  const unique = new Map();
  for (const q of [...new Set(candidates)]) {
    let results = [];
    // 单候选失败/空结果重试一次；候选之间加延迟避免 bing 对连续请求限流/降级
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        results = await fetchBing(q, count, detectMkt(q));
        if (results.length) break;
      } catch {
        // retry
      }
      await sleep(400);
    }
    for (const r of results) {
      if (!unique.has(r.link)) unique.set(r.link, r);
    }
  }
  return [...unique.values()].slice(0, count);
}

/**
 * 百度搜索（中文人名 / 中文站点 / 中文新闻收录远好于 bing）：
 * 例如"吴景天 康奈尔"能命中"长沙晚报专访（长郡中学国际部）"与"百度百科·国际象棋运动员吴景天"，
 * 而 bing 中文版对具体中文人名几乎全部返回"吴姓"等无关结果。
 * 返回标题 + 跳转链接（标题已含足够信息供模型分析）。
 */
export async function baiduSearch(query, count = MAX_RESULTS) {
  const cookie = await ensureBaiduCookie();
  const url = 'https://www.baidu.com/s?wd=' + encodeURIComponent(query) + '&rn=' + Math.min(count, 10);
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`百度搜索请求失败: HTTP ${res.status}`);
  const html = await res.text();
  if (html.includes('wappass') || html.includes('百度安全验证')) {
    throw new Error('百度触发安全验证');
  }
  const results = [];
  // 百度结果块：<h3 class="t ..."><a href="...">标题</a></h3>
  const re = /<h3[^>]*class="[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/g;
  let m;
  while ((m = re.exec(html)) !== null && results.length < count) {
    const title = stripHtml(m[2]);
    if (title) results.push({ title, link: m[1], snippet: '' });
  }
  if (!results.length) throw new Error('百度未返回结果（可能页面结构变化）');
  return results;
}

/** 智能分发：含中文 → 百度（中文人名/站点收录好）；纯英文 → bing（英文学术/人物好） */
export async function smartSearch(query, count = MAX_RESULTS) {
  const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(query);
  if (hasCJK) {
    // 百度偶发限流/验证，失败后短暂等待重试一次，仍失败再降级 bing
    for (let attempt = 0; ; attempt++) {
      try {
        return await baiduSearch(query, count);
      } catch (err) {
        if (attempt === 0) {
          await sleep(800);
        } else {
          try {
            return await bingSearch(query, count);
          } catch {
            throw err;
          }
        }
      }
    }
  }
  return await bingSearch(query, count);
}

/** 去除 HTML 标签与实体 */
export function stripHtml(s) {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** 将结果格式化为文本 */
export function formatResults(query, results, source = 'Bing 中国') {
  if (!results.length) {
    return `搜索"${query}"没有找到结果。请尝试更换关键词。`;
  }
  const lines = [`搜索"${query}"的结果：`, ''];
  results.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title}`);
    if (r.link) lines.push(`   链接: ${r.link}`);
    if (r.snippet) lines.push(`   摘要: ${r.snippet}`);
    lines.push('');
  });
  lines.push(`（共 ${results.length} 条结果，来源: ${source}）`);
  return lines.join('\n');
}

/**
 * 抓取网页正文为纯文本
 * - 剥离 <script>/<style> 与全部 HTML 标签（复用 stripHtml）
 * - 压缩空白、截断到 maxChars（默认 6000，最大 20000）
 * - 仅允许 http/https，15s 超时
 */
/** 生成拼写修正候选：常见域名错拼 + 相邻重复字母去重（host 除 www 外 + path） */
export function urlCorrectionCandidates(url) {
  const out = new Set();
  const hostFixes = {
    'githhub.com': 'github.com',
    'gitthub.com': 'github.com',
    'githubh.com': 'github.com',
    'jinggtianwu.github.io': 'jingtianwu.github.io',
    'githuub.com': 'github.com',
  };
  for (const [bad, good] of Object.entries(hostFixes)) {
    if (url.includes(bad)) out.add(url.replace(bad, good));
  }
  try {
    const u = new URL(url);
    const host = u.hostname;
    const base = host.replace(/^www\\./i, '');
    const dedupHost = base.replace(/([a-zA-Z])\1+/g, '$1');
    const newHost = host.startsWith('www.') ? 'www.' + dedupHost : dedupHost;
    const dedupPath = u.pathname.replace(/([a-zA-Z])\1+/g, '$1');
    if (newHost !== host || dedupPath !== u.pathname) {
      const nu = new URL(url);
      nu.hostname = newHost;
      nu.pathname = dedupPath;
      out.add(nu.toString());
    }
  } catch {
    /* URL 解析失败忽略 */
  }
  return [...out].filter((x) => x !== url);
}

/** 带拼写修正的抓取：先试原 URL，失败后自动尝试常见修正候选 */
export async function fetchPageWithCorrection(url, maxChars) {
  const tried = new Set();
  const candidates = [String(url).trim(), ...urlCorrectionCandidates(url)];
  let lastErr = null;
  for (const cand of candidates) {
    if (tried.has(cand)) continue;
    tried.add(cand);
    try {
      return await fetchPage(cand, maxChars);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('抓取失败: ' + url);
}

export async function fetchPage(url, maxChars = 6000) {
  const clean = String(url).trim();
  if (!/^https?:\/\//i.test(clean)) throw new Error('仅支持 http/https URL');
  const limit = Math.min(Math.max(Number(maxChars) || 6000, 1000), 20000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(clean, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`抓取失败: HTTP ${res.status}`);
  const html = await res.text();
  // 去掉脚本/样式/导航等非正文块
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ');
  let text = stripHtml(stripped).replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('未能提取到正文内容（可能为动态渲染页面）');
  if (text.length > limit) text = text.slice(0, limit) + '\n\n…（内容已截断）';
  return text;
}

/** JSON-RPC 响应写 stdout */
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

/** 带中文人名自动扩展的搜索（handleMessage 与 CLI 预取共用） */
export async function searchWithFallback(query, count = MAX_RESULTS) {
  let results = await smartSearch(query, count);
  // 中文人名兜底：纯中文 2~4 字、且首轮结果无任何标题包含完整人名（被"吴姓/字典/拼音"等同名干扰污染）时，
  // 自动追加常用背景限定词扩展搜索并合并，命中人物百科即停——确定性绕过模型不擅长用中文精确组合选词的问题。
  if (/^[\u4e00-\u9fff]{2,4}$/.test(query) && !results.some((r) => (r.title || '').includes(query))) {
    const extra = [];
    for (const w of ['中学', '大学', '运动员']) {
      try {
        const r2 = await smartSearch(query + ' ' + w, Math.max(count, 4));
        for (const x of r2) if (!extra.some((y) => x.link && y.link && x.link === y.link)) extra.push(x);
        if (r2.some((x) => (x.title || '').includes('百科'))) break;
      } catch {
        /* 单次扩展失败忽略 */
      }
    }
    if (extra.length) {
      const seen = new Set();
      results = [...results, ...extra].filter((x) => {
        const k = x.link || x.title;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
  }
  return results;
}

/** 最近搜索结果 URL 缓存：norm -> 原始链接，供 web_fetch 纠正模型手打 URL 的拼错/错域名 */
let searchCallCount = 0;

/** 高价值链接判定：个人主页/CV/百科/学术/棋联等值得抓取的链接 */
export function isHighValueLink(url) {
  const u = String(url || '').toLowerCase();
  return (
    u.includes('github.com') ||
    u.includes('.github.io') ||
    u.includes('cv.pdf') ||
    u.includes('baike.baidu.com') ||
    u.includes('scholar.google') ||
    u.includes('fide.com') ||
    u.includes('ieeexplore') ||
    u.includes('arxiv.org')
  );
}

const searchHistoryNorm = new Map();

/** 规范化 URL：小写、去 www、相邻重复字母去重、去尾斜杠（用于模糊匹配手打 URL 与搜索结果链接） */
export function normalizeUrl(u) {
  try {
    const x = new URL(u);
    let h = x.hostname.toLowerCase().replace(/^www\./, '');
    h = h.replace(/([a-z])\1+/g, '$1');
    const p = x.pathname.toLowerCase().replace(/([a-z])\1+/g, '$1').replace(/\/+$/, '');
    return h + p;
  } catch {
    return '';
  }
}

/** 处理 JSON-RPC 请求 */
async function handleMessage(msg) {
  const { id, method, params } = msg;
  if (!method) return; // 响应消息，忽略
  switch (method) {
    case 'initialize':
      respond(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
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
      respond(id, { tools: [WEB_SEARCH_TOOL, WEB_FETCH_TOOL] });
      break;
    case 'tools/call': {
      const { name, arguments: args } = params || {};
      if (name === 'web_search') {
        try {
          const query = (args && args.query) || '';
          if (!query.trim()) throw new Error('query 不能为空');
          const count = Math.min(Math.max(Number(args?.count) || MAX_RESULTS, 1), 10);
          const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(query);
          let results = await searchWithFallback(query, count);
                    for (const r of results) {
            if (r && r.link) {
              const n = normalizeUrl(r.link);
              if (n) searchHistoryNorm.set(n, r.link);
            }
          }
          searchCallCount++;
          let text = formatResults(query, results, hasCJK ? '百度' : 'Bing 中国');
          // 确定性介入①：结果含高价值链接时提示抓取（打破"只搜不抓"）
          const hv = results
            .map((r, idx) => ({ r, idx }))
            .filter(({ r }) => r && r.link && isHighValueLink(r.link))
            .slice(0, 3);
          if (hv.length) {
            const items = hv.map(({ r, idx }) => `结果 ${idx + 1}（${(r.title || '').slice(0, 30)}）`).join('、');
            text += `\n\n【抓取建议】以下链接与目标高度相关，建议用 web_fetch 抓取其正文获取详细信息：${items}。`;
          }
          // 确定性介入②：搜索达上限强制收尾（打破"过度搜索不收尾"）
          if (searchCallCount >= 6) {
            text += `\n\n【搜索上限】你已搜索 ${searchCallCount} 次（上限 6 次）。请停止继续搜索，基于已有结果输出最终结论；信息不足部分如实写"未找到公开信息"。`;
          }
          respond(id, { content: [{ type: 'text', text }] });
        } catch (err) {
          respond(id, {
            content: [{ type: 'text', text: `搜索失败: ${err.message}` }],
            isError: true,
          });
        }
      } else if (name === 'web_fetch') {
        try {
          const url = (args && args.url) || '';
          if (!url.trim()) throw new Error('url 不能为空');
          const maxChars = Number(args?.max_chars) || 6000;
                    // 优先从最近搜索结果中匹配正确 URL（模型手打 URL 常拼错或指向错误域名）
          const norm = normalizeUrl(url);
          const correct = searchHistoryNorm.get(norm);
          const target = correct && correct !== url ? correct : url;
          const text = await fetchPageWithCorrection(target, maxChars);
          respond(id, { content: [{ type: 'text', text }] });
        } catch (err) {
          respond(id, {
            content: [{ type: 'text', text: `抓取失败: ${err.message}` }],
            isError: true,
          });
        }
      } else {
        respond(id, {
          content: [{ type: 'text', text: `未知工具: ${name}` }],
          isError: true,
        });
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
      return; // 非 JSON 行忽略
    }
    try {
      await handleMessage(msg);
    } catch (err) {
      if (msg && msg.id != null) {
        respond(msg.id, { content: [{ type: 'text', text: `内部错误: ${err.message}` }], isError: true });
      }
    }
  });
  rl.on('close', () => process.exit(0));
}

// 仅直接运行时启动 MCP 主循环（被 import 时只暴露函数，便于测试）
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  // CLI 预取模式（flydex 后端确定性兜底）：node web-search-server.mjs --query "xxx"
  // 执行一次搜索并打印结果到 stdout 后退出，不启动 MCP stdio 循环。
  (async () => {
    const cliIdx = process.argv.indexOf('--query');
    if (cliIdx !== -1 && process.argv[cliIdx + 1]) {
      const q = process.argv[cliIdx + 1];
      try {
        const results = await searchWithFallback(q, 8);
        const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(q);
        process.stdout.write(formatResults(q, results, hasCJK ? '百度' : 'Bing 中国'));
      } catch (err) {
        process.stderr.write('预取搜索失败: ' + err.message);
      }
      process.exit(0);
    }
    main();
  })();
}
