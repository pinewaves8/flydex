import { Command } from '@tauri-apps/plugin-shell'

import type { ShellType } from '@/stores/useSettingsStore'

/**
 * Shell 探测与命令构造
 *
 * auto 模式按优先级探测：pwsh (PowerShell 7) → powershell.exe (Windows PowerShell 5.1) → cmd。
 * 探测结果在首次调用后缓存，避免每次执行命令都 spawn 一次探测进程。
 */
export interface ShellCommand {
  /** 可执行程序名（传给 shell 插件） */
  program: string
  /** 参数数组 */
  args: string[]
  /** 输出编码：Windows 中文 cmd 是 gbk，PowerShell/WSL 是 utf8 */
  encoding: 'gbk' | 'utf8'
  /** 已解析的 shell 名 */
  resolved: Exclude<ShellType, 'auto'>
}

export const SHELL_LABELS: Record<ShellType, string> = {
  auto: '自动 (pwsh → powershell → cmd)',
  pwsh: 'PowerShell 7 (pwsh)',
  powershell: 'Windows PowerShell 5.1',
  cmd: '命令提示符 (cmd)',
  wsl: 'WSL (bash)',
}

class ShellService {
  private cache: { [key in ShellType]?: Exclude<ShellType, 'auto'> } = {}
  private detected: Record<string, boolean | undefined> = {}

  /** 探测某个 shell 是否可用（where <name> 非空即存在） */
  private async isAvailable(name: string): Promise<boolean> {
    if (this.detected[name] !== undefined) return this.detected[name]
    try {
      const probe = Command.create('cmd', ['/c', `where ${name}`])
      let found = false
      probe.stdout.on('data', (d) => {
        if (String(d).trim().length > 0) found = true
      })
      const child = await probe.spawn()
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          void child.kill().catch(() => {})
          resolve()
        }, 3000)
        probe.on('close', () => {
          clearTimeout(t)
          resolve()
        })
      })
      this.detected[name] = found
      return found
    } catch {
      this.detected[name] = false
      return false
    }
  }

  /** 把用户配置的 shell 解析为实际可用的 shell（auto → 探测） */
  async resolve(preferred: ShellType): Promise<Exclude<ShellType, 'auto'>> {
    if (preferred !== 'auto') return preferred
    if (this.cache.auto) return this.cache.auto
    const candidates: Exclude<ShellType, 'auto'>[] = ['pwsh', 'powershell', 'cmd']
    for (const c of candidates) {
      const name = c === 'pwsh' ? 'pwsh' : c === 'powershell' ? 'powershell' : 'cmd'
      if (await this.isAvailable(name)) {
        this.cache.auto = c
        return c
      }
    }
    // 兜底 cmd（Windows 必有）
    this.cache.auto = 'cmd'
    return 'cmd'
  }

  /** 根据 shell 构造命令（含交互式提示符参数） */
  build(shell: Exclude<ShellType, 'auto'>, command: string): ShellCommand {
    switch (shell) {
      case 'pwsh':
      case 'powershell': {
        const program = shell === 'pwsh' ? 'pwsh' : 'powershell'
        // -NoExit 保留会话；-Command 执行；-NoLogo 去掉横幅
        return {
          program,
          args: ['-NoLogo', '-NoExit', '-Command', command],
          encoding: 'utf8',
          resolved: shell,
        }
      }
      case 'cmd':
        return { program: 'cmd', args: ['/c', command], encoding: 'gbk', resolved: 'cmd' }
      case 'wsl':
        // wsl 里调 bash -lc；注意 stdout 编码为 utf8
        return {
          program: 'wsl',
          args: ['--', 'bash', '-lc', command],
          encoding: 'utf8',
          resolved: 'wsl',
        }
    }
  }

  /** 获取 shell 启动横幅（面板初始化时显示当前 shell 名） */
  labelOf(shell: Exclude<ShellType, 'auto'>): string {
    return SHELL_LABELS[shell]
  }
}

export const shellService = new ShellService()
