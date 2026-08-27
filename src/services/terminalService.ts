import { Command, type Child } from '@tauri-apps/plugin-shell'

import { useWorkspaceStore } from '@/stores/useWorkspaceStore'

/**
 * 终端 Service
 *
 * 封装 Tauri shell 插件的命令执行，支持实时输出、工作目录维护、命令历史。
 */
export interface TerminalCallbacks {
  onStdout: (data: string) => void
  onStderr: (data: string) => void
  onExit: (code: number) => void
}

/** 命令历史记录 */
export interface CommandHistory {
  command: string
  timestamp: number
  exitCode: number | null
}

class TerminalService {
  private currentChild: Child | null = null
  private cwd: string = 'C:\\llm\\flydex'
  private history: CommandHistory[] = []
  private historyIndex: number = -1
  private readonly platform: 'windows' | 'unix' = navigator.userAgent.includes('Windows')
    ? 'windows'
    : 'unix'

  /** 设置工作目录 */
  setCwd(cwd: string) {
    this.cwd = cwd
  }

  /** 获取当前工作目录 */
  getCwd(): string {
    return this.cwd
  }

  /** 获取命令历史 */
  getHistory(): CommandHistory[] {
    return this.history
  }

  /** 获取上一条历史命令（向上箭头） */
  getPreviousHistory(): string | null {
    if (this.history.length === 0) return null
    this.historyIndex = Math.min(this.historyIndex + 1, this.history.length - 1)
    return this.history[this.history.length - 1 - this.historyIndex]?.command ?? null
  }

  /** 获取下一条历史命令（向下箭头） */
  getNextHistory(): string | null {
    if (this.historyIndex <= 0) {
      this.historyIndex = -1
      return null
    }
    this.historyIndex--
    return this.history[this.history.length - 1 - this.historyIndex]?.command ?? null
  }

  /** 重置历史浏览索引 */
  resetHistoryIndex() {
    this.historyIndex = -1
  }

  /** 手动记录一条命令历史（用于前端拦截的命令如 cls/clear） */
  recordHistory(command: string) {
    this.history.push({ command, timestamp: Date.now(), exitCode: 0 })
    this.resetHistoryIndex()
  }

  /** 是否有命令正在运行 */
  isRunning(): boolean {
    return this.currentChild !== null
  }

  /**
   * 执行命令
   * @param command 命令字符串
   * @param callbacks 回调函数
   */
  async execute(command: string, callbacks: TerminalCallbacks): Promise<void> {
    // 记录历史
    const historyEntry: CommandHistory = {
      command,
      timestamp: Date.now(),
      exitCode: null,
    }
    this.history.push(historyEntry)
    this.resetHistoryIndex()

    // 处理 cd 命令（shell 插件每次执行是独立进程，cd 不持久，需自己维护 cwd）
    // 支持: cd、cd..、cd ..、cd\、cd /、cd <path>、cd /d 盘符切换
    if (
      /^cd$/i.test(command.trim()) ||
      /^cd\s+/i.test(command) ||
      /^cd(\.\.?|[\\/])/i.test(command)
    ) {
      const target = command.replace(/^cd/i, '').trim()
      // 无参数：显示当前目录（cmd 行为）
      if (!target) {
        callbacks.onStdout(`\r\n${this.cwd}\r\n`)
        callbacks.onExit(0)
        historyEntry.exitCode = 0
        return
      }
      try {
        // 用 cmd 解析目标路径（处理 ..、\、相对/绝对、盘符切换），并验证存在
        const resolved = await this.resolveCdPath(target)
        this.cwd = resolved
        // 遵循 codex：cd 即切换全局工作区（Codex/Git/Projects 同步跟随）
        useWorkspaceStore.getState().setCwd(this.cwd)
        callbacks.onStdout(`\r\n`)
        callbacks.onExit(0)
        historyEntry.exitCode = 0
        return
      } catch {
        callbacks.onStderr(`cd: no such file or directory: ${target}\r\n`)
        callbacks.onExit(1)
        historyEntry.exitCode = 1
        return
      }
    }

    try {
      // Windows 上通过 cmd /c 执行；encoding 用 gbk 匹配 Windows 中文系统的 cmd 输出编码
      const cmd = Command.create('cmd', ['/c', command], {
        cwd: this.cwd,
        encoding: 'gbk',
      })

      cmd.stdout.on('data', (data) => {
        callbacks.onStdout(data)
      })

      cmd.stderr.on('data', (data) => {
        callbacks.onStderr(data)
      })

      cmd.on('close', (data) => {
        const code = data.code ?? 0
        this.currentChild = null
        callbacks.onExit(code)
        historyEntry.exitCode = code
      })

      this.currentChild = await cmd.spawn()
    } catch (err) {
      callbacks.onStderr(`Error: ${String(err)}\r\n`)
      callbacks.onExit(1)
      historyEntry.exitCode = 1
      this.currentChild = null
    }
  }

  /** 解析 cd 目标路径（调 Rust 后端规范化 + 校验，绕开 shell 插件的引号转义问题） */
  private async resolveCdPath(target: string): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string>('resolve_dir', { path: target, cwd: this.cwd })
  }

  /** 中断当前运行的命令（Ctrl+C） */
  async interrupt(): Promise<void> {
    const child = this.currentChild
    if (!child) return
    this.currentChild = null
    try {
      // Windows 上用 cmd 包装 taskkill /T /F 递归杀进程树，确保 ping 等子进程也被终止
      if (this.platform === 'windows') {
        await new Promise<void>((resolve) => {
          const killer = Command.create('cmd', ['/c', `taskkill /PID ${child.pid} /T /F`])
          killer.on('close', () => resolve())
          killer.spawn().catch(() => resolve())
        })
      }
      await child.kill().catch(() => {})
    } catch {
      // 忽略错误，尽力而为
      await child.kill().catch(() => {})
    }
  }
}

export const terminalService = new TerminalService()
