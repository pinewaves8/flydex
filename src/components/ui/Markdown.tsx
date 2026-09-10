import { Check, Copy } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

import 'highlight.js/styles/github-dark.css'

interface MarkdownProps {
  content: string
}

/** 递归从 React 节点中提取纯文本（rehype-highlight 会把代码转成 span 元素） */
function extractText(node: ReactNode): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return extractText(node.props.children)
  }
  return ''
}

/**
 * Markdown 渲染缓存(性能优化)
 *
 * 痛点:流式输出时,同一条 agent_message 的 content 反复重新渲染
 *   (虽然现在 streaming 优化后实际渲染的是 `full.slice(0, shown)`,
 *    不会复用整段;但完整消息存档后,切换视图/重渲染时整段 markdown
 *    要重新解析一次,长内容卡顿明显)
 *
 * 策略:用 content 字符串作为 key 缓存 React 元素
 *   - 命中:直接返回缓存的 React 元素,跳过 ReactMarkdown 解析
 *   - 未命中:解析并缓存(简单 LRU,容量 50 防止内存膨胀)
 */
const RENDER_CACHE = new Map<string, ReactNode>()
const CACHE_MAX = 50

function getCachedRender(content: string, factory: () => ReactNode): ReactNode {
  const cached = RENDER_CACHE.get(content)
  if (cached !== undefined) {
    // LRU:命中后移到末尾(Maps 保持插入顺序)
    RENDER_CACHE.delete(content)
    RENDER_CACHE.set(content, cached)
    return cached
  }
  const node = factory()
  RENDER_CACHE.set(content, node)
  if (RENDER_CACHE.size > CACHE_MAX) {
    // 删除最早插入的(最久未用)
    const firstKey = RENDER_CACHE.keys().next().value
    if (firstKey !== undefined) RENDER_CACHE.delete(firstKey)
  }
  return node
}

export function Markdown({ content }: MarkdownProps) {
  // 使用 useMemo 让 React 在 content 不变时直接复用 ReactNode
  const rendered = useMemo(
    () =>
      getCachedRender(content, () => (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
            code({ node: _node, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '')
              // react-markdown v9 已移除 inline 属性,改为:
              // 有语言标记(```lang)或含换行(多行) → 代码块;否则 → 行内代码
              const isMultiLine = extractText(children).includes('\n')
              if (match || isMultiLine) {
                return <CodeBlock language={match?.[1]}>{children}</CodeBlock>
              }
              return (
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs" {...props}>
                  {children}
                </code>
              )
            },
            a({ children, href }) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  {children}
                </a>
              )
            },
            table({ children }) {
              // 注意:必须保留 <table> 元素本身 —— 只把 <table> 包进滚动容器。
              // 若直接返回 <div>{children}</div>,thead/tbody 会变成 div 的直接子元素,
              // React 会报 validateDOMNesting 警告且表格语义丢失。
              return (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">{children}</table>
                </div>
              )
            },
          }}
        >
          {content}
        </ReactMarkdown>
      )),
    [content],
  )
  return <div className="markdown-body text-sm">{rendered}</div>
}

/** 带复制按钮的代码块，直接渲染 children 保留语法高亮 */
function CodeBlock({ language, children }: { language?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(extractText(children))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 忽略复制失败
    }
  }

  return (
    <div className="group relative my-2 overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1">
        <span className="font-mono text-[10px] uppercase text-muted-foreground">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto bg-[#0d1117] p-3">
        <code className="font-mono text-xs">{children}</code>
      </pre>
    </div>
  )
}
