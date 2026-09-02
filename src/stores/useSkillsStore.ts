import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'

import type { SkillDefinition } from '@/types/skill'

/** 内置技能定义 */
const BUILTIN_SKILLS: SkillDefinition[] = [
  {
    name: 'web-search',
    description:
      '在互联网上搜索信息，查询人物背景、新闻、最新动态、技术资料、事实核查等需要联网信息的场景',
    shortDescription: '网络搜索',
    triggers: ['搜索', '查一下', '搜索一下', '查找', '搜一下', '搜', 'search', 'look up', 'find'],
    interface: { displayName: '网络搜索', icon: 'Search', brandColor: '#00ffaa' },
    source: 'builtin',
    inputMarker: '',
    prompt:
      '请使用 web_search MCP 工具回答用户问题。规则：\n' +
      '1) 关键词精简：人名/主体 + 1~2 个关键限定；\n' +
      '2) 最多搜索 3 次，第 3 次仍无关键信息时停止搜索并向用户反馈；\n' +
      '3) 每次搜索后必须先整合所有结果再回复，不要每次工具调用完就写一段；\n' +
      '4) 不同姓名的搜索结果严禁交叉引用/拼接，必须严格区分每个搜索结果对应的人物；\n' +
      '5) 信息来自搜索结果才可作为事实，未覆盖的信息必须如实写"未找到公开信息"；\n' +
      '6) 不要拼错关键词（拼写错误会让所有搜索白费）。\n' +
      '搜索词：',
    enabled: true,
  },
  {
    name: 'review',
    description: '对当前代码变更进行审查，输出结构化审查报告（支持未提交/commit/base 三种模式）',
    shortDescription: '代码审查',
    triggers: ['审查', 'review', 'code review', 'cr', 'rv'],
    interface: { displayName: '代码审查', icon: 'FileSearch', brandColor: '#f59e0b' },
    source: 'builtin',
    inputMarker: '【审查指令】',
    prompt:
      '【强制执行：review 技能】\n' +
      '你现在进入代码审查模式。\n' +
      '审查指令会出现在本提示末尾的【审查指令】标记后。\n' +
      '规则：\n' +
      '1) 只读分析代码变更，禁止修改任何文件；\n' +
      '2) 输出格式：每行一个问题，格式为：级别|文件:行号|问题概述|修改建议；\n' +
      '3) 级别只能是【严重】【警告】【建议】【好评】之一；\n' +
      '4) 行号必须对应新文件行号，必须来自真实 diff；\n' +
      '5) 即使没有严重问题也要至少给出一条好评或说明；\n' +
      '6) 最后一行：审查总结：xxx；\n' +
      '7) 不要重复输出任何内容，每条问题与总结只出现一次。\n\n',
    enabled: true,
  },
  {
    name: 'plan',
    description: '先分析需求生成分步执行计划，批准后再执行（不直接修改文件）',
    shortDescription: '计划模式',
    triggers: ['计划', '方案', '规划', 'plan', '先计划'],
    interface: { displayName: '计划模式', icon: 'ListChecks', brandColor: '#6366f1' },
    source: 'builtin',
    inputMarker: '【用户需求】',
    prompt:
      '【强制执行：plan 技能】\n' +
      '你现在处于计划模式。\n' +
      '用户需求会出现在本提示末尾的【用户需求】标记后。\n' +
      '规则：\n' +
      '1) 当前工作目录是只读的，禁止创建、修改、删除任何文件；\n' +
      '2) 先分析用户需求（可以读取和搜索代码与文件），然后输出一份分步执行计划；\n' +
      '3) 用编号列表分步列出，每一步单独一行，格式：数字. 具体操作；\n' +
      '4) 禁止输出嵌套子列表、加粗标题、计划总结或前言；\n' +
      '5) 每步要具体、可执行、覆盖边界情况；\n' +
      '6) 只输出计划本身，不要执行任何写操作。\n\n',
    enabled: true,
  },
]

interface SkillsState {
  skills: SkillDefinition[]
  loading: boolean
  /** 最近一次加载的 baseDir（用于缓存判断） */
  lastLoadedDir: string

  /** Palette 状态 */
  paletteOpen: boolean
  paletteQuery: string

  /** 加载技能（合并内置 + 项目 + MCP） */
  load: (baseDir?: string) => Promise<void>
  /** 执行技能：返回注入文本 */
  execute: (name: string, userInput: string) => string
  /** 启用/禁用技能 */
  toggle: (name: string) => void
  /** 按名称查找技能 */
  find: (name: string) => SkillDefinition | undefined
  /** 搜索技能（模糊匹配名称和描述） */
  search: (query: string) => SkillDefinition[]
  /** 匹配触发词 */
  matchTriggers: (input: string) => SkillDefinition[]

  setPaletteOpen: (v: boolean) => void
  setPaletteQuery: (q: string) => void
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [...BUILTIN_SKILLS],
  loading: false,
  lastLoadedDir: '',

  paletteOpen: false,
  paletteQuery: '',

  load: async (baseDir?: string) => {
    set({ loading: true })
    const merged: SkillDefinition[] = [...BUILTIN_SKILLS]

    // 1. 加载项目技能
    if (baseDir) {
      try {
        const projectSkills = await invoke<SkillDefinition[]>('skill_list', {
          baseDir,
        })
        for (const ps of projectSkills) {
          ps.source = 'project'
          ps.enabled = true
          // 不覆盖同名内置技能
          if (!merged.some((s) => s.name === ps.name)) {
            merged.push(ps)
          }
        }
      } catch {
        // 静默失败
      }
    }

    // 2. 从 MCP 配置衍生技能
    try {
      const mcpServers =
        await invoke<
          { name: string; command?: string; args: string[]; env: Record<string, string> }[]
        >('mcp_list')
      for (const server of mcpServers) {
        const skillName = server.name.replace(/\s+/g, '-')
        if (merged.some((s) => s.name === skillName)) continue
        merged.push({
          name: skillName,
          description: `通过 MCP server「${server.name}」提供的外部工具能力`,
          shortDescription: `MCP: ${server.name}`,
          triggers: [server.name],
          interface: { displayName: server.name, icon: 'Plug', brandColor: '#0ea5e9' },
          source: 'mcp',
          mcpServer: server.name,
          prompt: `【技能:${skillName}】MCP 工具「${server.name}」已可用。\n你可以通过调用 MCP 工具来使用该能力。\n\n`,
          enabled: true,
        })
      }
    } catch {
      // 静默失败
    }

    set({ skills: merged, loading: false, lastLoadedDir: baseDir ?? '' })
  },

  execute: (name: string, userInput: string) => {
    const skill = get().skills.find((s) => s.name === name)
    if (!skill || !skill.enabled) return userInput
    const prefix = skill.prompt ?? ''
    // 用户输入紧跟指令，同一行（避免换行被模型当作消息边界）
    return `${prefix}${userInput}`
  },

  toggle: (name: string) => {
    set((state) => ({
      skills: state.skills.map((s) => (s.name === name ? { ...s, enabled: !s.enabled } : s)),
    }))
  },

  find: (name: string) => {
    return get().skills.find((s) => s.name === name)
  },

  search: (query: string) => {
    const { skills } = get()
    if (!query.trim()) return skills.filter((s) => s.enabled)
    const q = query.toLowerCase()
    return skills
      .filter((s) => s.enabled)
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.triggers.some((t) => t.toLowerCase().includes(q)) ||
          s.shortDescription?.toLowerCase().includes(q),
      )
  },

  matchTriggers: (input: string) => {
    const { skills } = get()
    const lower = input.toLowerCase()
    return skills.filter(
      (s) =>
        s.enabled &&
        s.triggers.some(
          (t) => lower.startsWith(t.toLowerCase()) || lower.includes(t.toLowerCase()),
        ),
    )
  },

  setPaletteOpen: (v) => set({ paletteOpen: v, paletteQuery: v ? get().paletteQuery : '' }),
  setPaletteQuery: (q) => set({ paletteQuery: q }),
}))
