import { useModelStore } from '@/stores/useModelStore'
import type { CodexMessage, TurnStats } from '@/types/codexJson'

/**
 * 反思服务 — Phase 1: Self-Reflection
 *
 * 直接调用当前模型 API（OpenAI 兼容）生成自我反思：
 * - 输入：本轮统计 + 最近几条消息
 * - 输出：markdown 格式的反思文本（哪里做得好 / 可改进 / 给用户建议）
 *
 * 设计要点：
 * - 不改任何代码，只生成参考消息
 * - 异步执行，不阻塞 UI
 * - 失败时静默（不影响正常使用）
 */

const SYSTEM_PROMPT = `你是一位资深工程教练，对刚才完成的 AI Agent 工作做一次简短反思。

输出格式（严格遵守）：
## ✅ 做得好的
- 简明列出 1-3 点

## ⚠️ 可改进的
- 简明列出 1-3 点（避免泛泛而谈，要具体）

## 💡 给用户的建议
- 1-2 条（下次对话怎么做能更高效）

要求：
- 简洁（不超过 200 字）
- 使用 markdown
- 不要重复列出工具调用细节（用户已经看到）
- 重点在**模式/习惯**层面，不在单次操作
- 用中文`

export interface ReflectInput {
  /** 本轮统计 */
  stats: TurnStats
  /** 用户最近输入（用于判断意图是否清晰） */
  lastUserInput: string
  /** 最后 3 条消息（用于上下文） */
  recentMessages: CodexMessage[]
}

/** 抽取消息的纯文本（去掉 tool args / fileChanges 等） */
function summarizeMessage(m: CodexMessage): string {
  if (m.kind === 'file_change' && m.fileChanges) {
    return `[文件变更] ${m.fileChanges.map((c) => `${c.path}(${c.kind})`).join(', ')}`
  }
  if (m.kind === 'tool' && m.toolName) {
    return `[工具] ${m.toolName}: ${m.content}`
  }
  // 截取前 100 字符
  return m.content.length > 100 ? m.content.slice(0, 100) + '…' : m.content
}

/** 构造反思 prompt */
function buildPrompt(input: ReflectInput): string {
  const recent = input.recentMessages
    .slice(-3)
    .map((m, i) => `${i + 1}. [${m.kind}] ${summarizeMessage(m)}`)
    .join('\n')
  return `## 本轮统计
- 耗时：${(input.stats.durationMs / 1000).toFixed(1)}s
- 工具调用：${input.stats.toolCalls}
- MCP 调用：${input.stats.mcpCalls}
- 文件变更：${input.stats.fileChanges}
- 错误：${input.stats.hadErrors ? '有' : '无'}
- Token：${input.stats.inputTokens + input.stats.outputTokens + input.stats.reasoningTokens}

## 用户输入
${input.lastUserInput || '(无)'}

## 最近消息
${recent || '(无)'}

请基于以上信息生成反思。`
}

/** 反思输入 → markdown 反思文本。失败返回 null（静默） */
export async function reflect(input: ReflectInput): Promise<string | null> {
  try {
    const cfg = useModelStore.getState().config
    if (!cfg) return null
    const provider = cfg.providers.find(
      (p) => p.id === cfg.models.find((m) => m.id === cfg.current_model)?.provider,
    )
    if (!provider) return null
    const model = cfg.models.find((m) => m.id === cfg.current_model)
    if (!model) return null

    const prompt = buildPrompt(input)
    const url = `${provider.base_url.replace(/\/$/, '')}/chat/completions`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.api_key}`,
      },
      body: JSON.stringify({
        model: model.id,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        max_tokens: 800,
        temperature: 0.3,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) return null
    return content
  } catch (e) {
    // 静默失败：反思是锦上添花，不能影响主流程
    console.warn('[reflect] failed:', e)
    return null
  }
}
