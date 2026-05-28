'use client'

import { type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDashboard } from '@/contexts/dashboard-context'
import { cn } from '@/lib/utils'
import { Target, FileText, Layers, Loader2, AlertCircle, Clock, Flame, Zap, LayoutList } from 'lucide-react'
import { NoteIcon } from '@/components/shared/note-icon'
import type { TaskRecord, NoteRecord, AreaRecord } from '@/db/types'
import { api } from '@/lib/api/client'
import { coverAttachmentUrl } from '@/lib/attachments/view'

// ─── Types ──────────────────────────────────────────────────

type EntityType = 'task' | 'note' | 'area' | 'deck'

interface EntitySegment {
  type: 'text' | 'entity'
  content: string
  entityType?: EntityType
  entityId?: string
}

// ─── Parser ─────────────────────────────────────────────────

const ENTITY_PATTERN = /\[\[(task|note|area|deck):([^\]]+)\]\]/g

export function parseEntityReferences(text: string): EntitySegment[] {
  const segments: EntitySegment[] = []
  let lastIndex = 0

  for (const match of text.matchAll(ENTITY_PATTERN)) {
    const matchStart = match.index!
    if (matchStart > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, matchStart) })
    }
    segments.push({
      type: 'entity',
      content: match[0],
      entityType: match[1] as EntityType,
      entityId: match[2],
    })
    lastIndex = matchStart + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) })
  }

  return segments
}

// ─── Config ─────────────────────────────────────────────────

const ENTITY_CONFIG: Record<EntityType, {
  icon: typeof Target
  label: string
  borderColor: string
  iconColor: string
  fetchUrl: (id: string) => string
}> = {
  task: {
    icon: Target,
    label: 'Task',
    borderColor: 'border-l-blue-500',
    iconColor: 'text-blue-500',
    fetchUrl: (id) => `/tasks/${id}`,
  },
  note: {
    icon: FileText,
    label: 'Note',
    borderColor: 'border-l-amber-500',
    iconColor: 'text-amber-500',
    fetchUrl: (id) => `/notes/${id}`,
  },
  area: {
    icon: Layers,
    label: 'Area',
    borderColor: 'border-l-emerald-500',
    iconColor: 'text-emerald-500',
    fetchUrl: (id) => `/areas/${id}`,
  },
  deck: {
    icon: LayoutList,
    label: 'Deck',
    borderColor: 'border-l-foreground',
    iconColor: 'text-foreground',
    fetchUrl: (id) => `/deck/${id}`,
  },
}

// ─── Helpers ────────────────────────────────────────────────

function formatDeadline(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days <= 7) return `In ${days}d`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^[-*]\s/gm, '')
    .trim()
}

// ─── Task Card ──────────────────────────────────────────────

function TaskCard({ data, onClick }: { data: TaskRecord; onClick: () => void }) {
  const deadline = formatDeadline(data.hardDeadline)
  const isOverdue = data.hardDeadline && new Date(data.hardDeadline) < new Date()

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-start gap-2.5 w-full rounded-lg border border-border border-l-2 bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/50',
        ENTITY_CONFIG.task.borderColor,
      )}
    >
      <Target size={14} className={cn('flex-shrink-0 mt-0.5', ENTITY_CONFIG.task.iconColor)} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground truncate">{data.title}</div>
        {data.description && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {stripMarkdown(data.description)}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {data.energy && (
            <span className={cn(
              'flex items-center gap-0.5 text-[10px] font-medium',
              data.energy === 'deep' ? 'text-orange-500' : 'text-sky-400',
            )}>
              {data.energy === 'deep' ? <Flame size={9} /> : <Zap size={9} />}
              {data.energy}
            </span>
          )}
          {data.effort && (
            <span className="text-[10px] text-muted-foreground font-medium uppercase">
              {data.effort}
            </span>
          )}
          {deadline && (
            <span className={cn(
              'flex items-center gap-0.5 text-[10px] font-medium',
              isOverdue ? 'text-destructive' : 'text-muted-foreground',
            )}>
              <Clock size={9} />
              {deadline}
            </span>
          )}
          {data.status === 'done' && (
            <span className="text-[10px] text-emerald-500 font-medium">Done</span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── Note Card ──────────────────────────────────────────────

function NoteCard({ data, onClick }: { data: NoteRecord; onClick: () => void }) {
  const preview = data.body ? stripMarkdown(data.body).slice(0, 120) : null

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-start gap-2.5 w-full rounded-lg border border-border border-l-2 bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/50',
        ENTITY_CONFIG.note.borderColor,
      )}
    >
      <NoteIcon body={data.body} size={14} className={cn('flex-shrink-0 mt-0.5', ENTITY_CONFIG.note.iconColor)} />
      <div className="flex-1 min-w-0">
        {data.title && (
          <div className="text-xs font-medium text-foreground truncate">{data.title}</div>
        )}
        {preview && (
          <div className={cn(
            'text-[11px] text-muted-foreground line-clamp-2',
            data.title ? 'mt-0.5' : '',
          )}>
            {preview}{preview.length >= 120 ? '...' : ''}
          </div>
        )}
      </div>
    </button>
  )
}

// ─── Area Card ──────────────────────────────────────────────

function AreaCard({ data }: { data: AreaRecord & { emoji?: string } }) {
  const coverUrl = coverAttachmentUrl(data.attachments)
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 w-full rounded-lg border border-border border-l-2 bg-card px-3 py-2.5',
        ENTITY_CONFIG.area.borderColor,
      )}
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          className="w-6 h-6 rounded-md object-cover flex-shrink-0 border border-border"
        />
      ) : data.emoji ? (
        <span className="w-6 h-6 rounded-md flex items-center justify-center text-sm flex-shrink-0 bg-accent/30 border border-border">
          {data.emoji}
        </span>
      ) : (
        <Layers size={14} className={cn('flex-shrink-0', ENTITY_CONFIG.area.iconColor)} />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground truncate">{data.name}</div>
        {data.description && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {data.description}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Deck Card ───────────────────────────────────────────────

function DeckCard({ data, onClick }: { data: { id: string; framing?: string | null; items: { taskId: string; rationale: string }[]; createdAt: string }; onClick: () => void }) {
  const itemCount = data.items?.length ?? 0

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-start gap-2.5 w-full rounded-lg border border-border border-l-2 bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/50',
        ENTITY_CONFIG.deck.borderColor,
      )}
    >
      <LayoutList size={14} className={cn('flex-shrink-0 mt-0.5', ENTITY_CONFIG.deck.iconColor)} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground">
          Your new deck is ready
        </div>
        {data.framing && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {data.framing}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] text-muted-foreground font-medium">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
          <span className="text-[10px] text-foreground font-medium">
            View deck
          </span>
        </div>
      </div>
    </button>
  )
}

// ─── EntityChip (orchestrator) ──────────────────────────────

// Cheap sanity gate so LLM hallucinations like `[[area:null]]` don't hit the
// API. UUIDv7 (what we mint) always matches /^[0-9a-f-]{36}$/i — anything
// else is garbage, so skip the fetch and render "not found" inline.
function isPlausibleEntityId(id: string): boolean {
  return /^[0-9a-f-]{8,}$/i.test(id)
}

function EntityChip({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const { openTask, openNote, openDeck } = useDashboard()
  const config = ENTITY_CONFIG[entityType]
  const validId = isPlausibleEntityId(entityId)

  const { data, isLoading, isError } = useQuery({
    queryKey: [entityType, entityId],
    queryFn: () => api.get<unknown>(config.fetchUrl(entityId)),
    enabled: validId,
    retry: false,
    staleTime: 30_000,
  })

  if (!validId) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border border-l-2 border-l-destructive bg-card px-3 py-2 my-1">
        <AlertCircle size={12} className="text-destructive" />
        <span className="text-[11px] text-muted-foreground">{config.label} not found</span>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className={cn(
        'flex items-center gap-2 rounded-lg border border-border border-l-2 bg-card px-3 py-2.5 my-1',
        config.borderColor,
      )}>
        <Loader2 size={12} className="animate-spin text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">Loading {config.label.toLowerCase()}...</span>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border border-l-2 border-l-destructive bg-card px-3 py-2 my-1">
        <AlertCircle size={12} className="text-destructive" />
        <span className="text-[11px] text-muted-foreground">{config.label} not found</span>
      </div>
    )
  }

  if (entityType === 'task') {
    return (
      <div className="my-1">
        <TaskCard data={data as TaskRecord} onClick={() => openTask(entityId)} />
      </div>
    )
  }

  if (entityType === 'note') {
    return (
      <div className="my-1">
        <NoteCard data={data as NoteRecord} onClick={() => openNote(entityId)} />
      </div>
    )
  }

  if (entityType === 'area') {
    return (
      <div className="my-1">
        <AreaCard data={data as AreaRecord & { emoji?: string }} />
      </div>
    )
  }

  if (entityType === 'deck') {
    return (
      <div className="my-1">
        <DeckCard data={data as Parameters<typeof DeckCard>[0]['data']} onClick={() => openDeck(entityId)} />
      </div>
    )
  }

  return null
}

// ─── Message renderer with entity references ────────────────

interface EntityAwareTextProps {
  text: string
  renderMarkdown: (text: string, key: number) => ReactNode
}

export function EntityAwareText({ text, renderMarkdown }: EntityAwareTextProps) {
  const segments = parseEntityReferences(text)

  // No references — fast path
  if (segments.length === 1 && segments[0].type === 'text') {
    return <>{renderMarkdown(text, 0)}</>
  }

  return (
    <>
      {segments.map((segment, i) => {
        if (segment.type === 'entity') {
          return (
            <EntityChip
              key={i}
              entityType={segment.entityType!}
              entityId={segment.entityId!}
            />
          )
        }
        return renderMarkdown(segment.content, i)
      })}
    </>
  )
}
