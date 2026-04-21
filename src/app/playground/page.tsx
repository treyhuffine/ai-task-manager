'use client'

import { useMemo, useState, useRef, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Send, Square, Sparkles, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAuthToken } from '@/lib/api/client'
import { APP_NAME } from '@/constants/app'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import { McpToolDisplay } from '@/components/playground/mcp-tool-display'

const MODEL_OPTIONS = [
  { id: 'gpt-5.4-mini', label: 'OpenAI · gpt-5.4-mini' },
  { id: 'gpt-5.4', label: 'OpenAI · gpt-5.4' },
  { id: 'claude-sonnet-4-5', label: 'Anthropic · claude-sonnet-4-5' },
]

export default function PlaygroundPage() {
  const [model, setModel] = useState(MODEL_OPTIONS[0].id)
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/playground/chat',
        headers: (): Record<string, string> => {
          const token = getAuthToken()
          return token ? { Authorization: `Bearer ${token}` } : {}
        },
        body: () => ({ model }),
      }),
    [model],
  )

  const { messages, sendMessage, status, stop } = useChat({ transport })

  const isStreaming = status === 'streaming'
  const isLoading = status === 'submitted' || isStreaming

  const handleSubmit = useCallback(() => {
    const text = input.trim()
    if (!text) return
    sendMessage({ text })
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [input, sendMessage])

  const hasMessages = messages.length > 0

  return (
    <div className="flex flex-col h-dvh bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 h-12 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-primary" />
          <h1 className="text-sm font-semibold text-foreground">MCP Playground</h1>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Dogfood the MCP surface
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="text-xs rounded border border-border bg-background px-2 py-1 focus:outline-none focus:border-primary/50"
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Conversation */}
      <div className="flex-1 min-h-0 flex flex-col">
        {hasMessages ? (
          <Conversation className="flex-1">
            <ConversationContent className="gap-4 p-4 max-w-3xl mx-auto w-full">
              {messages.map((message) => (
                <Message key={message.id} from={message.role} className="max-w-full">
                  <MessageContent className="text-sm">
                    {message.parts.map((part, i) => {
                      if (part.type === 'text') {
                        if (message.role === 'user') {
                          return <p key={i} className="whitespace-pre-wrap">{part.text}</p>
                        }
                        return (
                          <MessageResponse key={i} className="text-sm">
                            {part.text}
                          </MessageResponse>
                        )
                      }

                      // Tool-call parts — both MCP tools come across as `tool-query` / `tool-update`
                      if (part.type.startsWith('tool-')) {
                        const toolName = part.type.replace('tool-', '')
                        const p = part as unknown as {
                          state: string
                          input?: unknown
                          output?: string
                          errorText?: string
                        }
                        return (
                          <McpToolDisplay
                            key={i}
                            toolName={toolName}
                            input={p.input}
                            state={p.state}
                            output={p.output}
                            errorText={p.errorText}
                          />
                        )
                      }

                      if (part.type === 'dynamic-tool') {
                        const p = part as unknown as {
                          toolName: string
                          state: string
                          input?: unknown
                          output?: string
                          errorText?: string
                        }
                        return (
                          <McpToolDisplay
                            key={i}
                            toolName={p.toolName}
                            input={p.input}
                            state={p.state}
                            output={p.output}
                            errorText={p.errorText}
                          />
                        )
                      }

                      return null
                    })}
                  </MessageContent>
                </Message>
              ))}
              {isLoading && messages[messages.length - 1]?.role === 'user' && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
                  <Loader2 size={12} className="animate-spin" />
                  <span>Thinking…</span>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        ) : (
          <EmptyState />
        )}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-border p-3">
        <div className="max-w-3xl mx-auto">
          <div className="rounded-lg border border-border bg-card focus-within:border-primary/50 transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your tasks, plan your day, add a note…"
              rows={1}
              className={cn(
                'w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none px-3 pt-2.5 pb-1',
                'max-h-40 min-h-[28px]',
              )}
              onInput={(e) => {
                const target = e.currentTarget
                target.style.height = 'auto'
                target.style.height = Math.min(target.scrollHeight, 160) + 'px'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (isStreaming) stop()
                  else handleSubmit()
                }
              }}
            />
            <div className="flex items-center justify-end gap-1 px-2 pb-1.5">
              <button
                type="button"
                onClick={() => (isStreaming ? stop() : handleSubmit())}
                disabled={!isStreaming && !input.trim()}
                className={cn(
                  'flex-shrink-0 p-1.5 rounded-md transition-colors text-primary',
                  isStreaming ? 'hover:bg-destructive/10' : 'hover:bg-primary/10',
                  !isStreaming && !input.trim() && 'opacity-40',
                )}
                aria-label={isStreaming ? 'Stop' : 'Send'}
              >
                {isStreaming ? <Square size={16} /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 gap-3">
      <Sparkles size={28} className="text-primary/60" />
      <p className="text-sm text-foreground text-center max-w-md">
        Chat with a model that only has {APP_NAME}&apos;s <code className="font-mono text-xs">query</code> and{' '}
        <code className="font-mono text-xs">update</code> tools.
      </p>
      <p className="text-xs text-muted-foreground text-center max-w-md">
        Click any tool call below a response to inspect the full round-trip: what you asked, what the
        server agent did on the inside, and what came back.
      </p>
      <div className="text-xs text-muted-foreground space-y-1 pt-4">
        <div>Try:</div>
        <ul className="list-disc list-inside space-y-0.5">
          <li>&quot;What areas do I have, and how many active tasks in each?&quot;</li>
          <li>&quot;What&apos;s on my plate for today?&quot;</li>
          <li>&quot;Add a task to review the MCP playground this week.&quot;</li>
        </ul>
      </div>
    </div>
  )
}
