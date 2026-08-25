import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { CodexEvent, CodexOutputLine, CodexStatus } from '@/types/codex'

/**
 * Codex 交互 Hook
 *
 * 封装与 Tauri 后端的 codex exec 通信，
 * 提供发送指令、流式接收输出、状态管理。
 */
export function useCodex() {
  const [status, setStatus] = useState<CodexStatus>('idle')
  const [output, setOutput] = useState<CodexOutputLine[]>([])
  const [exitCode, setExitCode] = useState<number | null>(null)
  const lineIdRef = useRef(0)

  // 组件挂载时监听事件，卸载时取消监听
  // 注意：React 18 StrictMode 开发模式下 useEffect 会执行两次，
  // 异步 listen 完成前清理函数就可能被调用，需要 cancelled 标志防止重复注册
  useEffect(() => {
    let cancelled = false
    let outputUnlisten: UnlistenFn | null = null
    let doneUnlisten: UnlistenFn | null = null

    const setupListeners = async () => {
      const out = await listen<CodexEvent>('codex-output', (event) => {
        const payload = event.payload
        if (payload.type === 'Started') {
          setOutput((prev) => [
            ...prev,
            {
              id: lineIdRef.current++,
              text: `▸ Codex 已启动 (PID: ${payload.data.pid})，正在思考…请耐心等待`,
              kind: 'stdout',
            },
          ])
        } else if (payload.type === 'Output') {
          setOutput((prev) => [
            ...prev,
            { id: lineIdRef.current++, text: payload.data.text, kind: 'stdout' },
          ])
        } else if (payload.type === 'Error') {
          setOutput((prev) => [
            ...prev,
            { id: lineIdRef.current++, text: payload.data.message, kind: 'stderr' },
          ])
        }
      })

      const done = await listen<CodexEvent>('codex-done', (event) => {
        const payload = event.payload
        if (payload.type === 'Done') {
          setExitCode(payload.data.exit_code)
          setStatus(payload.data.exit_code === 0 ? 'done' : 'error')
        }
      })

      // 异步完成后检查是否已卸载（StrictMode 下第一次挂载会被取消）
      if (cancelled) {
        out()
        done()
        return
      }
      outputUnlisten = out
      doneUnlisten = done
    }

    setupListeners()

    return () => {
      cancelled = true
      outputUnlisten?.()
      doneUnlisten?.()
    }
  }, [])

  // 发送指令
  const run = useCallback(async (command: string, workdir?: string) => {
    setStatus('running')
    setOutput([])
    setExitCode(null)
    lineIdRef.current = 0

    try {
      await invoke('run_codex', { command, workdir: workdir ?? null })
      // 兜底：invoke 返回说明 Rust 端已执行完毕，如果 done 事件丢失，强制更新状态
      setStatus((prev) => (prev === 'running' ? 'done' : prev))
    } catch (err) {
      setOutput((prev) => [
        ...prev,
        {
          id: lineIdRef.current++,
          text: `Failed to start codex: ${String(err)}`,
          kind: 'stderr',
        },
      ])
      setStatus('error')
    }
  }, [])

  // 清空输出
  const clear = useCallback(() => {
    setOutput([])
    setExitCode(null)
    setStatus('idle')
  }, [])

  return { status, output, exitCode, run, clear }
}
