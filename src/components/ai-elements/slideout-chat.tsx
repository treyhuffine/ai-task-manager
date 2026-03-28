'use client'

import { useState } from 'react'
import { MessageSquare, X, Send, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from './conversation'

const CHAT_PANEL_MIN_WIDTH = 300

interface SlideoutChatProps {
  /** Current slideout width — used to decide panel vs bubble */
  slideoutWidth: number
  /** Width threshold below which the chat collapses to a bubble */
  collapseThreshold?: number
  /** Context label shown in the empty state */
  contextLabel?: string
}

export function SlideoutChat({
  slideoutWidth,
  collapseThreshold = 740,
  contextLabel = 'this item',
}: SlideoutChatProps) {
  const [bubbleOpen, setBubbleOpen] = useState(false)
  const showPanel = slideoutWidth >= collapseThreshold

  // If panel mode, always render inline
  if (showPanel) {
    return <ChatPanel contextLabel={contextLabel} />
  }

  // Bubble mode
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
          <ChatPanel contextLabel={contextLabel} compact />
        </div>
      )}

      <button
        onClick={() => setBubbleOpen((o) => !o)}
        className={cn(
          'absolute bottom-4 right-4 z-40 flex items-center justify-center w-10 h-10 rounded-full shadow-lg transition-all',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          bubbleOpen && 'bg-muted text-muted-foreground hover:bg-muted/80',
        )}
        aria-label="Toggle AI chat"
      >
        {bubbleOpen ? <X size={18} /> : <MessageSquare size={18} />}
      </button>
    </>
  )
}

function ChatPanel({
  contextLabel,
  compact,
}: {
  contextLabel: string
  compact?: boolean
}) {
  const [inputValue, setInputValue] = useState('')

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
          <ConversationEmptyState
            title="Ask AI anything"
            description={`Get help with ${contextLabel} — brainstorm, refine, break down, or summarize.`}
            icon={<Sparkles size={24} />}
            className="text-xs [&_h3]:text-xs [&_p]:text-[11px]"
          />
        </ConversationContent>
      </Conversation>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-border p-2">
        <div className="flex items-end gap-1.5 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-primary/50 transition-colors">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ask AI..."
            rows={1}
            className={cn(
              'flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none',
              'max-h-24 min-h-[20px]',
            )}
            onInput={(e) => {
              const target = e.currentTarget
              target.style.height = 'auto'
              target.style.height = Math.min(target.scrollHeight, 96) + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                // Chat not wired up yet
              }
            }}
          />
          <button
            className={cn(
              'flex-shrink-0 p-1 rounded-md transition-colors',
              inputValue.trim()
                ? 'text-primary hover:bg-primary/10'
                : 'text-muted-foreground/30 cursor-default',
            )}
            disabled={!inputValue.trim()}
            aria-label="Send message"
          >
            <Send size={14} />
          </button>
        </div>
        <p className="text-[9px] text-muted-foreground/40 text-center mt-1.5">
          AI can help brainstorm, refine, and organize
        </p>
      </div>
    </div>
  )
}
