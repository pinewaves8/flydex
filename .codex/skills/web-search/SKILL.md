---
name: web-search
description: 在互联网上搜索信息，查询人物背景、新闻、最新动态、技术资料、事实核查等需要联网信息的场景
short-description: 网络搜索
triggers:
  - 搜索
  - 查一下
  - 搜索一下
  - 查找
  - 搜一下
  - 搜
  - search
  - look up
  - find
interface:
  display-name: 网络搜索
  icon: Search
  brand-color: "#00ffaa"
---

# 网络搜索技能

你现在必须使用 `web_search` MCP 工具来回答用户的联网查询。

## 规则

1. 不要先输出任何文字、确认或开场白
2. 立即调用 `web_search` 工具，参数 `query` 使用简洁关键词
3. 仅当 web_search 返回结果后再基于结果回答
4. 搜索结果未覆盖的信息必须如实写"未找到公开信息"
5. 不允许编造其他工具名（如 browser/browsers 等）

## 查询关键词

保持简洁：人名/主体 + 1~2 个关键限定即可。不要堆叠过多修饰词。