import { Check, Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'
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

export function Markdown({ content }: MarkdownProps) {
  return (
    <div className="markdown-body text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ node: _node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            if (inline) {
              return (
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs" {...props}>
                  {children}
                </code>
              )
            }
            return <CodeBlock language={match?.[1]}>{children}</CodeBlock>
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
            return <div className="overflow-x-auto">{children}</div>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
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
