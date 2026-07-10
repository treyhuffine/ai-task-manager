'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, X, MessageSquare, MessageSquarePlus, Loader2, RefreshCw } from 'lucide-react'
import { api, ApiError } from '@/lib/api/client'
import { useRuntimeStatus } from '@/hooks/use-execution'
import { HarnessChatSession } from '@/components/chat/harness-chat'
import { cn } from '@/lib/utils'
import type { TaskRecord, NoteRecord, ChatSessionRecord, EffortLevel } from '@/db/types'
import type { ProviderId } from '@/lib/agent-options'

const CHAT_PANEL_MIN_WIDTH = 420

type DocumentType = 'task' | 'note'
type DocumentData = TaskRecord | NoteRecord

interface DocumentChatResponse {
  session: ChatSessionRecord
}

// ─── Hook ─────────────────────────────────────────────────────

/**
 * The in-document (note/task) chat, backed by a focused `type='content'`
 * harness session (the user's Claude/Codex subscription) rather than a
 * direct API-key model. GET has ensure semantics — the server creates the
 * session if none exists — so once loaded `sessionId` is stable across
 * reopens (persistent thread). `newChat` archives it and starts fresh.
 *
 * `status` is kept for the slideouts' `aiBusy` check: it tracks the session's
 * live run state (the harness turn) so they can guard doc edits while the
 * agent is mid-change. When a turn finishes we refetch the entity so the
 * AI's edits land in the editor immediately.
 */
export function useDocumentChat(documentType: DocumentType, document: DocumentData | null) {
  const qc = useQueryClient()
  const entityId = document?.id ?? null
  const queryKey = ['document-chat', documentType, entityId] as const

  const query = useQuery({
    queryKey,
    queryFn: () =>
      api.get<DocumentChatResponse>(
        `/document-chat?entityType=${documentType}&entityId=${entityId}`,
      ),
    enabled: !!entityId,
    staleTime: 30_000,
  })

  const sessionId = query.data?.session.id ?? null
  const runtime = useRuntimeStatus(sessionId)
  const isRunning = runtime.data?.running ?? false

  // When a harness turn completes, the agent may have edited this entity
  // through update_task/update_note (MCP) — refetch so the editor reflects
  // it. Edge-triggered on running→idle; the session stream keeps
  // runtime-status live while the panel is mounted.
  const prevRunning = useRef(isRunning)
  useEffect(() => {
    if (prevRunning.current && !isRunning) {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['notes'] })
      if (entityId) {
        qc.invalidateQueries({ queryKey: [documentType, entityId] })
        qc.invalidateQueries({ queryKey: ['deck'] })
      }
    }
    prevRunning.current = isRunning
  }, [isRunning, qc, documentType, entityId])

  const newChat = useMutation({
    // Optional provider/model = the composer's "switch provider" → fresh chat
    // on the chosen provider. No args (void) = a plain new chat on the default.
    mutationFn: (opts: { providerId?: ProviderId; model?: string; effort?: EffortLevel } | void) =>
      api.post<DocumentChatResponse>('/document-chat', {
        entityType: documentType,
        entityId,
        ...(opts ?? {}),
      }),
    onSuccess: (data) => qc.setQueryData(queryKey, data),
  })

  return {
    sessionId,
    // Cast (not narrow) so the property keeps the full union — the slideouts'
    // `aiBusy` check still compares against 'submitted'. The harness model
    // collapses submitted+streaming into a single "running" state, so only
    // 'streaming'/'ready' are ever produced.
    status: (isRunning ? 'streaming' : 'ready') as DocumentChatStatus,
    isLoading: query.isLoading,
    error: query.error as unknown,
    refetch: query.refetch,
    newChat,
  }
}

type DocumentChatStatus = 'streaming' | 'submitted' | 'ready'

export type DocumentChatHandle = ReturnType<typeof useDocumentChat>

// ─── SlideoutChat ─────────────────────────────────────────────

interface SlideoutChatProps {
  /** Current slideout width — used to decide panel vs bubble */
  slideoutWidth: number
  /** Width threshold below which the chat collapses to a bubble */
  collapseThreshold?: number
  /** Label like "this task" or "this note" */
  contextLabel: string
  /** The chat instance from useDocumentChat */
  chat: DocumentChatHandle
  /** Whether the document is still loading */
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
    return <ChatPanel contextLabel={contextLabel} chat={chat} disabled={disabled} isMobile={isMobile} />
  }
  return <ChatBubble contextLabel={contextLabel} chat={chat} disabled={disabled} isMobile={isMobile} />
}

// ─── Bubble mode ─────────────────────────────────────────────

function ChatBubble({
  contextLabel,
  chat,
  disabled,
  isMobile,
}: {
  contextLabel: string
  chat: DocumentChatHandle
  disabled: boolean
  isMobile: boolean
}) {
  const [bubbleOpen, setBubbleOpen] = useState(false)
  const active = chat.status === 'streaming'

  return (
    <>
      {bubbleOpen && (
        <div className="absolute bottom-16 right-4 z-50 w-80 h-[440px] rounded-xl border border-border bg-background shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-150">
          <ChatPanel
            contextLabel={contextLabel}
            chat={chat}
            disabled={disabled}
            isMobile={isMobile}
            compact
            onClose={() => setBubbleOpen(false)}
          />
        </div>
      )}

      <button
        onClick={() => setBubbleOpen((o) => !o)}
        className={cn(
          'absolute bottom-4 right-4 z-40 flex items-center justify-center w-10 h-10 rounded-full shadow-lg transition-all',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          bubbleOpen && 'bg-muted text-muted-foreground hover:bg-muted/80',
          active && !bubbleOpen && 'ring-2 ring-primary/30',
        )}
        aria-label="Toggle AI chat"
      >
        {bubbleOpen ? <X size={18} /> : <MessageSquare size={18} />}
      </button>
    </>
  )
}

// ─── Chat panel (shared between inline and bubble) ──────────

function ChatPanel({
  contextLabel,
  compact,
  chat,
  disabled,
  isMobile,
  onClose,
}: {
  contextLabel: string
  compact?: boolean
  chat: DocumentChatHandle
  disabled: boolean
  isMobile: boolean
  onClose?: () => void
}) {
  return (
    <div
      className={cn(
        'flex flex-col bg-background overflow-hidden',
        compact ? 'flex-1' : 'border-l border-border',
      )}
      style={compact ? undefined : { width: CHAT_PANEL_MIN_WIDTH, minWidth: CHAT_PANEL_MIN_WIDTH }}
    >
      {/* Header — title, new-chat, and (bubble) close. */}
      <div className="flex items-center gap-2 px-3 h-11 flex-shrink-0 border-b border-border/60">
        <Sparkles size={12} className="text-primary" />
        <span className="text-xs font-medium text-foreground">AI Assistant</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => chat.newChat.mutate()}
            disabled={disabled || !chat.sessionId || chat.newChat.isPending}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
            title="New chat"
            aria-label="New chat"
          >
            <MessageSquarePlus size={14} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label="Close chat"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <ChatBody contextLabel={contextLabel} chat={chat} disabled={disabled} isMobile={isMobile} />
    </div>
  )
}

function ChatBody({
  contextLabel,
  chat,
  disabled,
  isMobile,
}: {
  contextLabel: string
  chat: DocumentChatHandle
  disabled: boolean
  isMobile: boolean
}) {
  if (disabled || chat.isLoading || chat.newChat.isPending) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (chat.error || !chat.sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-center px-6">
        <div>
          <p className="text-[12px] font-semibold text-foreground">Couldn&apos;t start the chat.</p>
          <p className="text-[11px] text-muted-foreground/80 mt-1">
            {chat.error instanceof ApiError ? chat.error.message : 'The agent may not be set up yet.'}
          </p>
          <button
            onClick={() => chat.refetch()}
            className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-medium text-primary hover:bg-primary/10"
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      </div>
    )
  }

  // Reuse the same harness chat surface the orchestrator + execution chats
  // use — transcript (with inline diff chips for the agent's edits), pending
  // input, and composer — keyed to this entity's content session.
  return (
    <div className="flex flex-1 min-h-0 flex-col" aria-label={`Chat about ${contextLabel}`}>
      <HarnessChatSession
        sessionId={chat.sessionId}
        isMobile={isMobile}
        onSwitchProvider={(next) => chat.newChat.mutate({
          providerId: next.harness,
          model: next.model,
          effort: next.effort,
        })}
        switchingProvider={chat.newChat.isPending}
      />
    </div>
  )
}
