/** Skill 来源 */
export type SkillSource = 'builtin' | 'project' | 'mcp'

/** Skill 界面配置 */
export interface SkillInterface {
  displayName?: string
  icon?: string
  brandColor?: string
}

/** Skill 定义 */
export interface SkillDefinition {
  name: string
  description: string
  shortDescription?: string
  triggers: string[]
  interface?: SkillInterface
  source: SkillSource
  /** SKILL.md 文件路径（项目技能） */
  path?: string
  /** 关联的 MCP server 名（MCP 衍生技能） */
  mcpServer?: string
  /** 注入给 codex 的指令文本 */
  prompt?: string
  /** 用户输入位置的标记（如【用户搜索】、【待审查】，默认【用户输入】） */
  inputMarker?: string
  enabled: boolean
}
