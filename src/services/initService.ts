import { invoke } from '@tauri-apps/api/core'

/** 单个候选文件信息(来自 Rust init_scanner) */
export interface CandidateFile {
  path: string
  size_bytes: number
  first_lines: string[]
}

/** 项目初始化扫描报告 */
export interface InitReport {
  workdir: string
  has_git: boolean
  has_readme: boolean
  candidates: CandidateFile[]
  spec_files: string[]
  requirements_files: string[]
  tech_spec_files: string[]
  build_files: string[]
  /** "A" 已有规范 / "B" 有文档无规范 / "C" 仅有骨架 / "D" 全新项目 */
  scenario: 'A' | 'B' | 'C' | 'D'
  scenario_label: string
  recommendation: string
}

/** 项目初始化 service(对齐 Claude Code `/init`) */
export const initService = {
  /** 扫描项目根目录,返回报告 */
  async scan(workdir: string): Promise<InitReport> {
    return invoke<InitReport>('init_scan', { workdir })
  },

  /** 安全写入项目文件(防止 ../ 越界;默认不覆盖已存在文件) */
  async writeFile(
    workdir: string,
    path: string,
    content: string,
    overwrite = false,
  ): Promise<WriteResult> {
    return invoke<WriteResult>('init_write_file', {
      workdir,
      path,
      content,
      overwrite,
    })
  },
}

/** 写入结果 */
export interface WriteResult {
  path: string
  bytes_written: number
  created: boolean
}

/** Init 流程状态枚举(对应 Rust InitStep) */
export type InitStep =
  | 'idle'
  | 'scanned'
  | 'collecting-requirements'
  | 'collecting-tech-spec'
  | 'ready-to-generate'
  | 'done'

const INIT_STEP_LABEL: Record<InitStep, string> = {
  idle: '未开始',
  scanned: '已扫描',
  'collecting-requirements': '收集需求中',
  'collecting-tech-spec': '收集技术栈中',
  'ready-to-generate': '等待生成 AGENTS.md',
  done: '已完成',
}

/** Init 状态数据 */
export interface InitStateData {
  step: InitStep
  workdir: string
  scenario: 'A' | 'B' | 'C' | 'D'
  written_files: string[]
  updated_at: string
}

/** Init service state operations */
export const initStateService = {
  async get(workdir: string): Promise<InitStateData | null> {
    return invoke<InitStateData | null>('init_get_state', { workdir })
  },
  async set(workdir: string, scenario: string, step: InitStep): Promise<InitStateData> {
    return invoke<InitStateData>('init_set_state', { workdir, scenario, step })
  },
  async clear(workdir: string): Promise<void> {
    return invoke<void>('init_clear_state', { workdir })
  },
  async markWritten(workdir: string, path: string): Promise<void> {
    return invoke<void>('init_mark_written', { workdir, path })
  },
}

/** Init step 的可读标签 */
export function getInitStepLabel(step: InitStep): string {
  return INIT_STEP_LABEL[step]
}

/** 判断 step 是否处于"进行中"(不是 idle / done) */
export function isInitInProgress(step: InitStep): boolean {
  return step !== 'idle' && step !== 'done'
}

/** 列出工作目录下的所有文件路径(@-mention 用) */
export async function listWorkdirFiles(workdir: string, maxDepth = 3): Promise<string[]> {
  return invoke<string[]>('list_files', { workdir, maxDepth })
}
