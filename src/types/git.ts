/** 文件变更状态 */
export type ChangeState =
  'untracked' | 'added' | 'modified' | 'staged' | 'staged_modified' | 'deleted' | 'renamed'

/** diff hunk */
export interface DiffHunk {
  /** hunk 头，如 "@@ -1,3 +1,4 @@" */
  header: string
  /** hunk 的完整内容（含 header 行） */
  content: string
  /** hunk 在 diff 中的起始行号 */
  start_line: number
}

/** 单个文件的变更信息 */
export interface FileChange {
  /** 文件路径（相对仓库根） */
  path: string
  /** 变更状态 */
  state: ChangeState
  /** 是否已暂存 */
  staged: boolean
  /** 该文件是否还有未暂存的修改 */
  unstaged: boolean
  /** 新增行数 */
  insertions: number
  /** 删除行数 */
  deletions: number
  /** 文件对应的 hunk 列表（未暂存部分） */
  hunks: DiffHunk[]
}

/** Git 状态快照 */
export interface GitStatus {
  /** 当前分支名 */
  branch: string
  /** 是否为 detached HEAD */
  detached: boolean
  /** 变更文件列表 */
  changes: FileChange[]
  /** 未推送的提交数 */
  ahead: number
  /** 未拉取的提交数 */
  behind: number
}

/** 分支信息 */
export interface GitBranch {
  /** 分支名 */
  name: string
  /** 是否为当前分支 */
  current: boolean
  /** 分支描述 */
  description: string
}

/** 提交结果 */
export interface CommitResult {
  /** 提交的短哈希 */
  hash: string
  /** 提交信息 */
  message: string
}
