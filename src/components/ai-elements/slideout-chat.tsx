'use client'

import { useState, useRef, useMemo, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import { useQueryClient } from '@tanstack/react-query'
import { DefaultChatTransport } from 'ai'
import { MessageSquare, X, Send, Sparkles, Square, Loader2, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from './conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from './message'
import type { TaskRecord, NoteRecord } from '@/db/types'

const CHAT_PANEL_MIN_WIDTH = 300

type DocumentType = 'task' | 'note'
type DocumentData = TaskRecord | NoteRecord

// ─── Hook ─────────────────────────────────────────────────────

export function useDocumentChat(documentType: DocumentType, document: DocumentData | null) {
  const queryClient = useQueryClient()
  const documentRef = useRef(document)
  documentRef.current = document

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/document-chat',
        body: () => ({
          documentType,
          document: documentRef.current,
        }),
      }),
    [documentType],
  )

  const onFinish = useCallback(() => {
    if (documentType === 'task') {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    } else {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    }
  }, [documentType, queryClient])

  const chatId = document ? `${documentType}-${document.id}` : undefined

  return useChat({ id: chatId, transport, onFinish })
}

// ─── SlideoutChat ─────────────────────────────────────────────

interface SlideoutChatProps {
  /** Current slideout width — used to decide panel vs bubble */
  slideoutWidth: number
  /** Width threshold below which the chat collapses to a bubble */
  collapseThreshold?: number
  /** Label like "this task" or "this note" */
  contextLabel: string
  /** The chat instance from useDocumentChat */
  chat: ReturnType<typeof useChat>
  /** Whether the document is loaded */
  disabled: boolean
}

export function SlideoutChat({
  slideoutWidth,
  collapseThreshold = 740,
  contextLabel,
  chat,
  disabled,
}: SlideoutChatProps) {
  const showPanel = slideoutWidth >= collapseThreshold

  if (showPanel) {
    return (
      <ChatPanel
        contextLabel={contextLabel}
        chat={chat}
        disabled={disabled}
      />
    )
  }

  return <ChatBubble contextLabel={contextLabel} chat={chat} disabled={disabled} />
}

// ─── Bubble mode ─────────────────────────────────────────────

function ChatBubble({
  contextLabel,
  chat,
  disabled,
}: {
  contextLabel: string
  chat: ReturnType<typeof useChat>
  disabled: boolean
}) {
  const [bubbleOpen, setBubbleOpen] = useState(false)
  const hasMessages = chat.messages.length > 0

  return (
    <>
      {bubbleOpen && (
        <div className="absolute bottom-16 right-4 z-50 w-80 h-[420px] rounded-xl border border-border bg-background shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-150">
          <div className="flex items-center justify-between px-3 h-10 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <Sparkles size={12} className="text-primary" />
              AI Assistant
            </div>
            <button
              onClick={() => setBubbleOpen(false)}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X size={14} />
            </button>
          </div>
          <ChatPanel contextLabel={contextLabel} compact chat={chat} disabled={disabled} />
        </div>
      )}

      <button
        onClick={() => setBubbleOpen((o) => !o)}
        className={cn(
          'absolute bottom-4 right-4 z-40 flex items-center justify-center w-10 h-10 rounded-full shadow-lg transition-all',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          bubbleOpen && 'bg-muted text-muted-foreground hover:bg-muted/80',
          hasMessages && !bubbleOpen && 'ring-2 ring-primary/30',
        )}
        aria-label="Toggle AI chat"
      >
        {bubbleOpen ? <X size={18} /> : <MessageSquare size={18} />}
      </button>
    </>
  )
}

// ─── Tool call indicator ─────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  updateTaskTitle: 'Updated title',
  updateTaskBody: 'Updated body',
  updateTaskProperties: 'Updated properties',
  updateNoteTitle: 'Updated title',
  updateNoteBody: 'Updated body',
  updateNoteProperties: 'Updated properties',
}

function ToolCallIndicator({ toolName }: { toolName: string }) {
  const label = TOOL_LABELS[toolName] ?? toolName
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 py-1">
      <Wrench size={10} />
      <span>{label}</span>
    </div>
  )
}

// ─── Chat panel (shared between inline and bubble) ──────────

function ChatPanel({
  contextLabel,
  compact,
  chat,
  disabled,
}: {
  contextLabel: string
  compact?: boolean
  chat: ReturnType<typeof useChat>
  disabled: boolean
}) {
  const { messages, sendMessage, status, stop } = chat
  const isStreaming = status === 'streaming'
  const isLoading = status === 'submitted' || isStreaming
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [input, setInput] = useState('')

  const handleSubmit = () => {
    const text = input.trim()
    if (!text || disabled) return
    sendMessage({ text })
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col bg-background overflow-hidden',
        compact ? 'flex-1' : 'border-l border-border',
      )}
      style={compact ? undefined : { width: CHAT_PANEL_MIN_WIDTH, minWidth: CHAT_PANEL_MIN_WIDTH }}
    >
      {/* Header — only in panel mode (bubble mode has its own header) */}
      {!compact && (
        <div className="flex items-center gap-2 px-3 h-11 border-b border-border flex-shrink-0">
          <Sparkles size={12} className="text-primary" />
          <span className="text-xs font-medium text-foreground">AI Assistant</span>
        </div>
      )}

      {/* Conversation area */}
      <Conversation className="flex-1">
        <ConversationContent className="gap-4 p-3">
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="Ask AI anything"
              description={`Get help with ${contextLabel} — brainstorm, refine, break down, or summarize.`}
              icon={<Sparkles size={24} />}
              className="text-xs [&_h3]:text-xs [&_p]:text-[11px]"
            />
          ) : (
            messages.map((message) => (
              <Message key={message.id} from={message.role} className="max-w-full">
                <MessageContent className="text-xs">
                  {message.parts.map((part, i) => {
                    if (part.type === 'text') {
                      if (message.role === 'user') {
                        return <p key={i}>{part.text}</p>
                      }
                      return (
                        <MessageResponse key={i} className="text-xs [&_p]:text-xs [&_li]:text-xs [&_code]:text-[11px]">
                          {part.text}
                        </MessageResponse>
                      )
                    }
                    if (part.type === 'dynamic-tool') {
                      return <ToolCallIndicator key={i} toolName={part.toolName} />
                    }
                    if (part.type.startsWith('tool-')) {
                      return <ToolCallIndicator key={i} toolName={part.type.replace('tool-', '')} />
                    }
                    return null
                  })}
                </MessageContent>
              </Message>
            ))
          )}
          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              <span>Thinking...</span>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-border p-2">
        <div className="flex items-end gap-1.5 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-primary/50 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={disabled ? 'Loading...' : 'Ask AI...'}
            disabled={disabled}
            rows={1}
            className={cn(
              'flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none',
              'max-h-24 min-h-[20px]',
              disabled && 'opacity-50',
            )}
            onInput={(e) => {
              const target = e.currentTarget
              target.style.height = 'auto'
              target.style.height = Math.min(target.scrollHeight, 96) + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (isStreaming) {
                  stop()
                } else {
                  handleSubmit()
                }
              }
            }}
          />
          <button
            onClick={() => {
              if (isStreaming) {
                stop()
              } else {
                handleSubmit()
              }
            }}
            className={cn(
              'flex-shrink-0 p-1 rounded-md transition-colors',
              isStreaming
                ? 'text-destructive hover:bg-destructive/10'
                : input.trim() && !disabled
                  ? 'text-primary hover:bg-primary/10'
                  : 'text-muted-foreground/30 cursor-default',
            )}
            disabled={!isStreaming && (!input.trim() || disabled)}
            aria-label={isStreaming ? 'Stop' : 'Send message'}
          >
            {isStreaming ? <Square size={14} /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
