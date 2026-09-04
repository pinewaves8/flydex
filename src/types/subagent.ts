/** 子代理角色（对齐 Claude Code 内置专用子代理：Explore / Plan / General） */
export type SubagentRole = 'general' | 'explore' | 'plan'

export interface RolePreset {
  role: SubagentRole
  label: string
  desc: string
  /** 选中该角色时预填的指令模板（用户已有指令则作为角色提示前置） */
  template: string
  /** 该角色的默认沙箱（Explore/Plan 为只读研究型） */
  defaultSandbox: 'inherit' | 'read-only'
  /** 推荐模型说明（Explore 建议轻量模型提速） */
  hintModel: string
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    role: 'general',
    label: '通用',
    desc: '通用子代理，完整工具权限',
    template: '',
    defaultSandbox: 'inherit',
    hintModel: '跟随全局模型',
  },
  {
    role: 'explore',
    label: 'Explore 探索',
    desc: '快速只读代码库分析（建议轻量模型提速）',
    template:
      '【Explore 代码探索】只读探索工作区，回答：整体结构、关键模块职责、与问题相关的文件定位。输出结构化结论（文件路径 + 一句话职责）。不修改任何文件，不执行写操作。',
    defaultSandbox: 'read-only',
    hintModel: '建议选轻量/快速模型',
  },
  {
    role: 'plan',
    label: 'Plan 研究',
    desc: '只读研究并产出可执行方案',
    template:
      '【Plan 研究】以只读方式研究并输出一份可执行方案，包含：目标、关键路径、风险、分步实施计划。不修改任何文件。',
    defaultSandbox: 'read-only',
    hintModel: '建议选推理较强模型',
  },
]

export function rolePreset(role: SubagentRole): RolePreset {
  return ROLE_PRESETS.find((r) => r.role === role) ?? ROLE_PRESETS[0]
}
