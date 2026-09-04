/** 沙箱模式（对应 codex sandbox_mode） */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** 审批策略（对应 codex approval_policy） */
export type ApprovalPolicy = 'untrusted' | 'on-request' | 'never'

/** 审批历史记录 */
export interface ApprovalRecord {
  id: string
  timestamp: number
  command: string
  approved: boolean
  run_id: string
}

/** 权限规则动作（deny 优先于 allow） */
export type RuleAction = 'deny' | 'allow'

/** 单条权限规则 */
export interface PermissionRule {
  pattern: string
  action: RuleAction
  note: string
}

/** 权限规则集（持久化 ~/.flydex/permissions.json） */
export interface PermissionRules {
  rules: PermissionRule[]
}

/** 规则决策测试结果（7.3 security_test_rule） */
export interface RuleTestResult {
  tag: 'auto_deny' | 'auto_accept' | 'ask'
  reason: string
  denied: boolean
}

/** 决策标签展示元信息 */
export const RULE_TEST_TAGS: {
  value: RuleTestResult['tag']
  label: string
  color: string
  desc: string
}[] = [
  {
    value: 'auto_deny',
    label: '自动拒绝',
    color: 'text-red-500 bg-red-500/10',
    desc: '规则引擎判定危险，工具执行前直接拒绝',
  },
  {
    value: 'auto_accept',
    label: '自动放行',
    color: 'text-emerald-500 bg-emerald-500/10',
    desc: '命中 allow 规则或全自动模式，直接执行',
  },
  {
    value: 'ask',
    label: '需审批',
    color: 'text-amber-500 bg-amber-500/10',
    desc: '未命中 deny/allow 规则，推审批框由你决定',
  },
]

export function ruleTestTagLabel(tag: RuleTestResult['tag']): string {
  return RULE_TEST_TAGS.find((t) => t.value === tag)?.label ?? tag
}

/** 安全配置 */
export interface SecurityConfig {
  sandbox_mode: SandboxMode
  approval_policy: ApprovalPolicy
  /** git 自动快照开关：每轮 turn 完成后自动 commit 本地快照（对齐 Claude Code） */
  auto_checkpoint: boolean
  history: ApprovalRecord[]
}

/** 沙箱模式展示元信息 */
export const SANDBOX_MODES: { value: SandboxMode; label: string; desc: string; icon: string }[] = [
  {
    value: 'read-only',
    label: '只读',
    desc: 'AI 只能读文件，无法写入或执行写操作。最安全，适合纯分析。',
    icon: '👁️',
  },
  {
    value: 'workspace-write',
    label: '工作区写入',
    desc: '允许在项目目录内写入和修改。⚠️ Windows 上对 .git 目录写入受限，git add/commit 可能失败，建议改用完全访问完成 git 操作。',
    icon: '📝',
  },
  {
    value: 'danger-full-access',
    label: '完全访问',
    desc: '无沙箱，AI 以你的真实权限运行，可操作任意文件。高风险。',
    icon: '⚡',
  },
]

/** 审批策略展示元信息 */
export const APPROVAL_POLICIES: {
  value: ApprovalPolicy
  label: string
  desc: string
  icon: string
}[] = [
  {
    value: 'untrusted',
    label: '询问不可信操作',
    desc: '只对 codex 判定为不可信的命令请求审批，常规操作自动执行。',
    icon: '🛡️',
  },
  {
    value: 'on-request',
    label: '按需请求',
    desc: '模型在需要提权或执行敏感操作时主动请求你确认（推荐）。',
    icon: '🤝',
  },
  {
    value: 'never',
    label: '自动放行',
    desc: '不询问任何操作，AI 全自动执行。仅适合可信环境。',
    icon: '🚀',
  },
]

export function sandboxLabel(mode: SandboxMode): string {
  return SANDBOX_MODES.find((m) => m.value === mode)?.label ?? mode
}

export function approvalLabel(policy: ApprovalPolicy): string {
  return APPROVAL_POLICIES.find((p) => p.value === policy)?.label ?? policy
}
