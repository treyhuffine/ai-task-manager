'use client'

import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { useQueryClient } from '@tanstack/react-query'
import { DefaultChatTransport } from 'ai'
import { MessageSquare, X, Send, Sparkles, Square, Loader2, Wrench, Mic } from 'lucide-react'
import { useVoiceInput } from '@/hooks/use-voice-input'
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
import { getAuthToken } from '@/lib/api/client'

const CHAT_PANEL_MIN_WIDTH = 420

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
        headers: (): Record<string, string> => {
          const token = getAuthToken()
          return token ? { Authorization: `Bearer ${token}` } : {}
        },
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
  // Force bubble on mobile (<md = 768px). On md+, use the resize-driven threshold.
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  const showPanel = !isMobile && slideoutWidth >= collapseThreshold

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
          <div className="flex items-center justify-between px-3 h-10 flex-shrink-0">
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
  const voice = useVoiceInput()

  const handleSubmit = useCallback((text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || disabled) return
    sendMessage({ text: msg })
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, disabled, sendMessage])

  // Auto-send when voice transcript arrives
  const lastTranscriptRef = useRef('')
  if (voice.transcript && voice.transcript !== lastTranscriptRef.current && !voice.isRecording) {
    lastTranscriptRef.current = voice.transcript
    // Use setTimeout to avoid calling sendMessage during render
    setTimeout(() => {
      handleSubmit(voice.transcript)
      voice.clearTranscript()
    }, 0)
  }

  const hasMessages = messages.length > 0

  const inputElement = (
    <div className={cn('flex-shrink-0 p-2', hasMessages && 'border-t border-border')}>
      <div className="rounded-lg border border-border bg-card focus-within:border-primary/50 transition-colors">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? 'Loading...' : `Ask about ${contextLabel}...`}
          disabled={disabled}
          rows={1}
          className={cn(
            'w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none px-3 pt-2 pb-1',
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
        <div className="flex items-center justify-end gap-1 px-2 pb-1.5">
          {voice.isSupported && (
            <button
              onClick={voice.toggleRecording}
              disabled={voice.isTranscribing}
              className={cn(
                'flex-shrink-0 p-1 rounded-md transition-colors',
                voice.isRecording
                  ? 'text-destructive hover:bg-destructive/10'
                  : 'text-primary hover:bg-primary/10',
              )}
              aria-label={voice.isRecording ? 'Stop recording' : 'Voice input'}
            >
              {voice.isRecording ? <Square size={14} /> : <Mic size={14} />}
            </button>
          )}
          <button
            onClick={() => {
              if (isStreaming) {
                stop()
              } else {
                handleSubmit()
              }
            }}
            className={cn(
              'flex-shrink-0 p-1 rounded-md transition-colors text-primary',
              isStreaming
                ? 'hover:bg-destructive/10'
                : 'hover:bg-primary/10',
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
        <div className="flex items-center gap-2 px-3 h-11 flex-shrink-0">
          <Sparkles size={12} className="text-primary" />
          <span className="text-xs font-medium text-foreground">AI Assistant</span>
        </div>
      )}

      {hasMessages ? (
        <>
          {/* Conversation area */}
          <Conversation className="flex-1">
            <ConversationContent className="gap-4 p-3">
              {messages.map((message) => (
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
              ))}
              {isLoading && messages[messages.length - 1]?.role === 'user' && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={12} className="animate-spin" />
                  <span>Thinking...</span>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {/* Input pinned to bottom */}
          {inputElement}
        </>
      ) : (
        /* Empty state — input positioned in upper quarter */
        <div className="flex-1 flex flex-col items-center justify-start px-3 gap-2 pt-[20%]">
          <p className="text-sm text-foreground/80 text-center italic">
            Edit, plan, break down, or explore {contextLabel} with AI.
          </p>
          <div className="w-full [&_textarea]:min-h-[72px]">
            {inputElement}
          </div>
        </div>
      )}
    </div>
  )
}
