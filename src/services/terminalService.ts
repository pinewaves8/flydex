import { Command, type Child } from '@tauri-apps/plugin-shell'

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

    // 处理 cd 命令（shell 插件每次执行是独立进程，cd 不持久）
    const cdMatch = command.match(/^cd\s+(.+)$/i)
    if (cdMatch) {
      const target = cdMatch[1].trim()
      try {
        // 简单的路径处理
        let newCwd = target
        if (!/^[A-Za-z]:/.test(target) && !target.startsWith('\\\\')) {
          newCwd = `${this.cwd}\\${target}`
        }
        // 规范化路径（简单处理 .. 和 .）
        const parts = newCwd.split(/[\\/]/).filter(Boolean)
        const normalized: string[] = []
        for (const part of parts) {
          if (part === '..') normalized.pop()
          else if (part !== '.') normalized.push(part)
        }
        this.cwd = normalized.join('\\')
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
