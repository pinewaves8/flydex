import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'

import 'xterm/css/xterm.css'

import { shellService } from '@/services/shellService'
import { terminalService } from '@/services/terminalService'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'

/** 计算字符串在终端中的显示宽度（中文等宽字符算 2 列） */
function strWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    // CJK 统一表意文字、全角符号等占 2 列
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fffd)
    ) {
      w += 2
    } else {
      w += 1
    }
  }
  return w
}

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const inputBufferRef = useRef<string>('')
  const cursorIndexRef = useRef<number>(0)
  const handleInputRef = useRef<(data: string) => void>(() => {})
  const shellRef = useRef<Exclude<import('@/stores/useSettingsStore').ShellType, 'auto'>>('cmd')
  const [isRunning, setIsRunning] = useState(false)
  const [shellLabel, setShellLabel] = useState<string>('')
  const workspaceCwd = useWorkspaceStore((s) => s.cwd)

  // 全局工作目录变化时同步终端（遵循 codex：cwd 是唯一事实源）
  useEffect(() => {
    terminalService.setCwd(workspaceCwd)
  }, [workspaceCwd])

  // 初始化 xterm
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      convertEol: true,
      scrollback: 10000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(container)
    fitAddon.fit()

    termRef.current = term
    fitAddonRef.current = fitAddon

    // 显示欢迎信息
    term.writeln('\x1b[1;36mFlydex Terminal\x1b[0m')
    term.writeln(`工作目录: ${terminalService.getCwd()}`)
    // 异步解析当前 shell（auto 模式探测）并更新标题
    void terminalService
      .getResolvedShell()
      .then((shell) => {
        shellRef.current = shell
        const label = shellService.labelOf(shell)
        setShellLabel(label)
        term.writeln(`Shell: ${label}`)
        term.writeln('输入命令执行，上下箭头浏览历史，Ctrl+C 中断\r\n')
        writePrompt()
      })
      .catch(() => {
        term.writeln('输入命令执行，上下箭头浏览历史，Ctrl+C 中断\r\n')
        writePrompt()
      })

    // 处理窗口大小变化
    const handleResize = () => {
      fitAddon.fit()
    }
    window.addEventListener('resize', handleResize)

    // 处理键盘输入
    term.onData((data) => {
      handleInputRef.current(data)
    })

    // 键盘快捷键处理（复制/粘贴/全选），其余按键放行给 xterm
    term.attachCustomKeyEventHandler((event) => {
      // Ctrl+Shift+C 强制复制
      if (event.ctrlKey && event.shiftKey && event.key === 'c') {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection())
          return false
        }
        return true
      }
      // Ctrl+C：有选中文本则复制，否则放行给 xterm（中断信号 \x03）
      if (event.ctrlKey && !event.shiftKey && event.key === 'c') {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection())
          return false
        }
        return true
      }
      // Ctrl+V：放行给 xterm 内部 textarea 的默认粘贴处理
      if (event.ctrlKey && !event.shiftKey && event.key === 'v') {
        return true
      }
      // Ctrl+A：全选（保持焦点避免选区被清除）
      if (event.ctrlKey && !event.shiftKey && event.key === 'a') {
        term.focus()
        if (term.hasSelection()) {
          term.clearSelection()
        } else {
          term.selectAll()
        }
        return false
      }
      return true
    })

    // 右键粘贴支持
    const handleContextMenu = (e: MouseEvent) => {
      if (term.hasSelection()) return
      e.preventDefault()
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text) term.paste(text)
        })
        .catch(() => {})
    }
    container.addEventListener('contextmenu', handleContextMenu)

    // 聚焦终端
    term.focus()

    // 窗口重新获得焦点时聚焦终端
    const handleWindowFocus = () => {
      term.focus()
    }
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      window.removeEventListener('resize', handleResize)
      container.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('focus', handleWindowFocus)
      term.dispose()
    }
  }, [])

  // 写入提示符
  const writePrompt = () => {
    const term = termRef.current
    if (!term) return
    const cwd = terminalService.getCwd()
    // 简化路径显示（只显示最后一级目录）
    const shortCwd = cwd.split('\\').pop() || cwd
    const shell = shellRef.current
    if (shell === 'pwsh' || shell === 'powershell') {
      term.write(`\x1b[1;32mPS ${shortCwd}\x1b[0m\x1b[1;34m>\x1b[0m `)
    } else if (shell === 'wsl') {
      term.write(`\x1b[1;32m${shortCwd}\x1b[0m\x1b[1;34m$\x1b[0m `)
    } else {
      term.write(`\x1b[1;32m${shortCwd}\x1b[0m\x1b[1;34m>\x1b[0m `)
    }
    inputBufferRef.current = ''
    cursorIndexRef.current = 0
  }

  /** 重绘当前输入行（清除整行后重写 prompt + buffer，并定位光标） */
  const redrawLine = () => {
    const term = termRef.current
    if (!term) return
    const buffer = inputBufferRef.current
    const cursor = cursorIndexRef.current
    const cwd = terminalService.getCwd()
    const shortCwd = cwd.split('\\').pop() || cwd
    // 回到行首，清除整行
    term.write('\r\x1b[K')
    // 重写 prompt + buffer
    term.write(`\x1b[1;32m${shortCwd}\x1b[0m\x1b[1;34m>\x1b[0m `)
    term.write(buffer)
    // 移动光标到 cursor 位置（光标前的显示宽度）
    const widthBeforeCursor = strWidth(buffer.slice(0, cursor))
    const totalWidth = strWidth(buffer)
    const moveLeft = totalWidth - widthBeforeCursor
    if (moveLeft > 0) {
      term.write(`\x1b[${moveLeft}D`)
    }
  }

  // 处理键盘输入
  const handleInput = (data: string) => {
    const term = termRef.current
    if (!term) return

    // 过滤鼠标事件序列（\x1b[M...）和无关控制序列
    if (
      data.startsWith('\x1b[M') ||
      (data.startsWith('\x1b[') &&
        data.length > 2 &&
        (data.startsWith('\x1b[<') || data.startsWith('\x1b[M')))
    ) {
      return
    }
    // 过滤单独的 CSI/SS3 起始（等待后续字节）
    if (data === '\x1b[' || data === '\x1b') {
      return
    }

    // 命令运行中：只允许 Ctrl+C 中断，忽略其他输入
    if (terminalService.isRunning()) {
      if (data === '\x03') {
        terminalService.interrupt()
        // 只显示 ^C，prompt 由 taskkill 触发 close 后统一绘制
        term.write('^C\r\n')
        inputBufferRef.current = ''
        cursorIndexRef.current = 0
      }
      return
    }

    // 回车执行命令
    if (data === '\r') {
      const command = inputBufferRef.current.trim()
      term.write('\r\n')
      if (command) {
        executeCommand(command)
      } else {
        writePrompt()
      }
      return
    }

    // 退格（删除光标前字符）
    if (data === '\x7f' || data === '\b') {
      if (cursorIndexRef.current > 0) {
        inputBufferRef.current =
          inputBufferRef.current.slice(0, cursorIndexRef.current - 1) +
          inputBufferRef.current.slice(cursorIndexRef.current)
        cursorIndexRef.current -= 1
        redrawLine()
      }
      return
    }

    // Ctrl+C 中断（空闲时清除当前行）
    if (data === '\x03') {
      inputBufferRef.current = ''
      cursorIndexRef.current = 0
      term.write('^C\r\n')
      writePrompt()
      return
    }

    // Ctrl+L 清屏
    if (data === '\x0c') {
      term.clear()
      writePrompt()
      return
    }

    // 左箭头 - 光标左移
    if (data === '\x1b[D') {
      if (cursorIndexRef.current > 0) {
        cursorIndexRef.current -= 1
        redrawLine()
      }
      return
    }

    // 右箭头 - 光标右移
    if (data === '\x1b[C') {
      if (cursorIndexRef.current < inputBufferRef.current.length) {
        cursorIndexRef.current += 1
        redrawLine()
      }
      return
    }

    // 上箭头 - 历史命令
    if (data === '\x1b[A') {
      const prev = terminalService.getPreviousHistory()
      if (prev !== null) {
        inputBufferRef.current = prev
        cursorIndexRef.current = prev.length
        redrawLine()
      }
      return
    }

    // 下箭头 - 历史命令
    if (data === '\x1b[B') {
      const next = terminalService.getNextHistory()
      if (next !== null) {
        inputBufferRef.current = next
        cursorIndexRef.current = next.length
      } else {
        inputBufferRef.current = ''
        cursorIndexRef.current = 0
      }
      redrawLine()
      return
    }

    // 普通字符输入（含中文等非 ASCII 字符），插入到光标位置
    const code = data.charCodeAt(0)
    if (code >= 0x20 && data !== '\x7f' && data !== '\x1b') {
      inputBufferRef.current =
        inputBufferRef.current.slice(0, cursorIndexRef.current) +
        data +
        inputBufferRef.current.slice(cursorIndexRef.current)
      cursorIndexRef.current += data.length
      redrawLine()
    }
  }

  // 更新 ref，供 useEffect 中的 term.onData 调用
  handleInputRef.current = handleInput

  // 执行命令
  const executeCommand = async (command: string) => {
    const term = termRef.current
    if (!term) return

    // 拦截 cls / clear 命令，前端直接清屏（记录历史，上下键可回看）
    if (command === 'cls' || command === 'clear') {
      terminalService.recordHistory(command)
      term.clear()
      writePrompt()
      return
    }

    setIsRunning(true)

    await terminalService.execute(command, {
      onStdout: (data) => {
        term.write(data)
      },
      onStderr: (data) => {
        term.write(`\x1b[31m${data}\x1b[0m`)
      },
      onExit: (code) => {
        if (code !== 0) {
          term.write(`\r\n\x1b[33m[退出码: ${code}]\x1b[0m\r\n`)
        }
        setIsRunning(false)
        writePrompt()
      },
    })
  }

  return (
    <div className="flex h-full flex-col bg-[#0d1117]">
      {/* 终端工具栏 */}
      <div className="flex items-center justify-between border-b border-gray-700 bg-[#161b22] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-400">Terminal</span>
          {shellLabel && <span className="text-[10px] text-gray-500">{shellLabel}</span>}
          {isRunning && (
            <span className="flex items-center gap-1 text-xs text-yellow-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
              Running
            </span>
          )}
        </div>
        <div className="text-[10px] text-gray-500">{terminalService.getCwd()}</div>
      </div>
      {/* 终端区域 */}
      <div ref={containerRef} className="flex-1 overflow-hidden p-2" />
    </div>
  )
}
