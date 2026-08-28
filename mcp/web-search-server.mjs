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
    '在互联网上搜索关键词（使用 Bing 中国），返回标题、链接和摘要列表。' +
    '用于查询人物背景、新闻、最新动态、技术资料、事实核查等需要联网信息的场景。' +
    '搜索后请基于返回的摘要进行综合分析，不要声称未包含在结果中的信息。',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词（支持中文）' },
      count: { type: 'number', description: '返回结果数量，默认 8，最大 10' },
    },
    required: ['query'],
  },
};

/** 抓取并解析 cn.bing 搜索结果 */
export async function bingSearch(query, count = MAX_RESULTS) {
  const url =
    'https://cn.bing.com/search?q=' + encodeURIComponent(query) + '&count=' + count + '&mkt=zh-CN';
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
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
export function formatResults(query, results) {
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
  lines.push(`（共 ${results.length} 条结果，来源: Bing 中国）`);
  return lines.join('\n');
}

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
      respond(id, { tools: [WEB_SEARCH_TOOL] });
      break;
    case 'tools/call': {
      const { name, arguments: args } = params || {};
      if (name === 'web_search') {
        try {
          const query = (args && args.query) || '';
          if (!query.trim()) throw new Error('query 不能为空');
          const count = Math.min(Math.max(Number(args?.count) || MAX_RESULTS, 1), 10);
          const results = await bingSearch(query, count);
          const text = formatResults(query, results);
          respond(id, { content: [{ type: 'text', text }] });
        } catch (err) {
          respond(id, {
            content: [{ type: 'text', text: `搜索失败: ${err.message}` }],
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
  main();
}
