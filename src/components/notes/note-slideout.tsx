'use client'
import { EntityDetailHeader, EntityActionsMenu } from '@/components/entities/entity-detail-header';

import { useEffect, useCallback, useRef, useState, useMemo } from 'react'
import { EntitySheet } from '@/components/entities/entity-sheet'
import { ChevronLeft, X, ExternalLink, Pencil, Maximize2 } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { NoteEditor } from '@/components/editor/rich-editor'
import { LinkedReferences } from '@/components/shared/linked-references'
import { useNote, useUpdateNote, useDeleteNote } from '@/hooks/use-notes'
import { HOTKEYS, matchesHotkey } from '@/constants/commands'
import { AreaSelect } from '@/components/shared/area-select'
import { NoteKindHeading, NoteKindMenuItem } from '@/components/notes/note-kind'
import { SharedNoteBody } from '@/components/spaces/shared-note-body'
import { removeFromMyNotes } from '@/components/spaces/my-work'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { SlideoutChat, useDocumentChat } from '@/components/ai-elements/slideout-chat'
import { useDragResize } from '@/hooks/use-drag-resize'
import { ReferencingSessionsButton } from '@/components/shared/referencing-sessions-button'
import { EntityHistoryButton } from '@/components/chat-ui/edits/entity-history-button'
import { EntityChangeBanner } from '@/components/chat-ui/edits/entity-change-banner'
import { EntityViewToggle } from '@/components/entities/entity-view-toggle'
import { EntityAgentView } from '@/components/entities/entity-agent-view'
import { useEntityViewMode, resolveEntityView, type EntityViewMode } from '@/lib/client/entity-view-mode'
import { cn } from '@/lib/utils'
import { useDocumentAutosave, usePendingDocument } from '@/hooks/use-document-autosave';
import type { Attachment } from '@/db/types'
import { useOptionalHomeContext, useHomeStorageScope } from '@/components/home/home-context';
import { homeStorageIdentity } from '@/lib/home/document-scope';
import { homeResourceHref } from '@/lib/home/resource-href';
import { currentSpaceId } from '@/lib/spaces/document';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useSharedBody, SaveStatus, SharedBodyState } from '@/components/team/shared-body-editor';
import { TeamAudience, TeamEntityHistory } from '@/components/team/team-document-controls';
import { TeamAreaSelect } from '@/components/team/team-areas';
import { SaveNoteControl } from '@/components/spaces/my-work-control';
import { countWords } from '@/lib/notes/word-count'

const DEFAULT_WIDTH = 1200
const MIN_WIDTH = 420
const MAX_WIDTH = 1400

interface NoteSlideoutProps {
  noteId: string | null
  onClose: () => void
  onCloseAll: () => void
  hasHistory: boolean
}

export function NoteSlideout({ noteId, onClose, onCloseAll, hasHistory }: NoteSlideoutProps) {
  const home = useOptionalHomeContext()
  const team = home?.home.kind === 'team'
  const storageScope = useHomeStorageScope()
  const confirm = useConfirm()
  const full = useSearchParams().get('full') === '1'
  const fullPage = noteId ? homeResourceHref('note', noteId, team ? { kind: 'team', spaceId: currentSpaceId() } : undefined) + (team ? '&full=1' : '') : '#'
  const isOpen = noteId !== null
  const { data: savedNote } = useNote(noteId ?? '')
  const note = usePendingDocument('notes', noteId, savedNote)
  const updateNote = useUpdateNote()
  const autosave = useDocumentAutosave('notes', noteId, savedNote, updateNote.mutateAsync);
  const deleteNote = useDeleteNote()
  const router = useRouter()
  const chat = useDocumentChat('note', note ?? null, !team && !note?.sourceTeamId)
  const sharedBody = useSharedBody('note', team ? savedNote : undefined)
  const aiBusy = chat.status === 'streaming' || chat.status === 'submitted'

  // Agent-first trial (Settings > General > Notes and tasks). Per open: the
  // pref decides the starting view, the header toggle flips it for this note.
  const { agentFirst } = useEntityViewMode()
  const [viewOverride, setViewOverride] = useState<{ id: string; view: EntityViewMode } | null>(null)
  // A saved team note (docs/homes-spec.md §9.3) is the team's to edit: it
  // opens as a reference, with no document chat writing it.
  const shared = !!note?.sourceTeamId
  const view = shared || team ? 'editor' : resolveEntityView(agentFirst, viewOverride, noteId)
  const setView = useCallback(
    (next: EntityViewMode) => { if (noteId) setViewOverride({ id: noteId, view: next }) },
    [noteId],
  )

  const { size: width, isResizing, handleResizeStart } = useDragResize({
    edge: 'left',
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    defaultSize: DEFAULT_WIDTH,
    storageKey: homeStorageIdentity('ri.note-slideout.width', storageScope),
  })
  const containerRef = useRef<HTMLDivElement>(null)
  // Tracks attachments uploaded during this editing session so we can include
  // their metadata in save payloads. The server's derive step intersects these
  // with body-referenced file_names — uploads that never land in the body get
  // garbage-collected later by the reconciler.
  const pendingAttachmentsRef = useRef<Attachment[]>([])

  const handleAttachment = useCallback((attachment: Attachment) => {
    pendingAttachmentsRef.current = [...pendingAttachmentsRef.current, attachment]
  }, [])


  // Debounced save — separate timers so title and body don't cancel each other
  const handleTitleChange = useCallback(
    (title: string) => {
      if (!noteId) return

      autosave({ title })
    },
    [noteId, autosave]
  )

  const handleBodyChange = useCallback(
    (body: string) => {
      if (!noteId) return
      const attachments = pendingAttachmentsRef.current
      autosave({
        body,
        ...(attachments.length > 0 ? { attachments } : {}),
      })
    },
    [noteId, autosave]
  )

  const { wordCount, charCount } = useMemo(() => {
    const body = note?.body ?? ''
    return { wordCount: countWords(body), charCount: body.length }
  }, [note?.body])

  const handleFoldedHeadingsChange = useCallback(
    (folded: string[]) => {
      if (!noteId) return

      autosave({ foldedHeadings: folded })
    },
    [noteId, autosave]
  )

  const handleAreaChange = useCallback(
    (areaId: string | null) => {
      if (!noteId) return
      updateNote.mutate({ id: noteId, areaId: areaId })
    },
    [noteId, updateNote]
  )

  const handleArchive = useCallback(() => {
    if (!noteId) return
    updateNote.mutate({ id: noteId, status: 'archived' })
    onClose()
  }, [noteId, updateNote, onClose])

  const handleDelete = useCallback(async () => {
    if (!noteId) return
    if (!team) { deleteNote.mutate(noteId); onClose(); return }
    if (!await confirm({ title: 'Delete this note for everyone?', description: 'It leaves the team for good. Archive keeps it findable.', confirmLabel: 'Delete', tone: 'destructive' })) return
    await deleteNote.mutateAsync(noteId)
    onClose()
  }, [noteId, team, confirm, deleteNote, onClose])

  // Cmd+Enter → open full page
  useEffect(() => {
    if (!isOpen || !noteId) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesHotkey(e, HOTKEYS.openFullPage)) {
        e.preventDefault()
        router.push(fullPage)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, noteId, router, fullPage])

  // Cleanup save timers

  return (
    <EntitySheet open={isOpen} label="Note" width={width} fullWidth={Boolean(team && full)} contentRef={containerRef} resizing={isResizing} onClose={onClose} onCloseAll={onCloseAll} showCloseButton={false} onOpenAutoFocus={(event) => event.preventDefault()}>

        {/* Resize handle — desktop only */}
        <div
          className={cn(
            'hidden md:block w-1.5 cursor-col-resize flex-shrink-0 group relative',
            'hover:bg-primary/20 active:bg-primary/30 transition-colors',
            isResizing && 'bg-primary/30'
          )}
          onPointerDown={handleResizeStart}
          style={{ touchAction: 'none' }}
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* Panel content */}
        <div className="flex-1 flex flex-col bg-background border-l border-border overflow-hidden">
          {/* Header */}
          <EntityDetailHeader>
            <div className="flex items-center gap-1.5 group/nav">
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
                aria-label="Back"
              >
                <ChevronLeft size={16} />
                <kbd className="hidden group-hover/nav:inline px-1.5 py-0.5 bg-muted rounded text-[9px] text-muted-foreground/60 font-sans">
                  esc
                </kbd>
              </button>
              {hasHistory && (
                <button
                  onClick={onCloseAll}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors opacity-0 group-hover/nav:opacity-100 flex items-center gap-1.5"
                  aria-label="Close all"
                >
                  <X size={14} />
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[9px] text-muted-foreground/60 font-sans">
                    ⇧esc
                  </kbd>
                </button>
              )}
            </div>

            <div className="flex min-w-0 items-center gap-3">
              {agentFirst && !shared && !team && <EntityViewToggle value={view} onChange={setView} compact={width < 700} />}
              {noteId && !shared && (team && note ? <TeamEntityHistory kind="note" id={noteId} bodyRevision={note.bodyRevision} /> : <EntityHistoryButton entityType="note" entityId={noteId} />)}
              {noteId && <ReferencingSessionsButton entityType="note" entityId={noteId} />}
              <a
                href={fullPage}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) return
                  e.preventDefault()
                  if (noteId) router.push(fullPage)
                }}
                className="group/expand p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
                aria-label="Open full page"
              >
                <kbd className="hidden group-hover/expand:inline px-1.5 py-0.5 bg-muted rounded text-[9px] text-muted-foreground/60 font-sans">
                  {HOTKEYS.openFullPage.label}
                </kbd>
                <Maximize2 size={14} />
              </a>

              {team && note && <><SaveStatus status={sharedBody.status} /><SaveNoteControl noteId={note.id} /></>}
              <EntityActionsMenu deleteLabel={team ? "Delete for everyone" : "Delete"} onArchive={shared ? undefined : handleArchive} onDelete={shared || team && !home?.capabilities.deletePermanently ? undefined : handleDelete}>
                  {note?.url && <DropdownMenuItem asChild><a href={note.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Open link</a></DropdownMenuItem>}
                  {shared && note?.sourceTeamId && note.sourceNoteId && <DropdownMenuItem onSelect={() => void removeFromMyNotes(note.sourceTeamId!, note.sourceNoteId!).then(onClose)}><X size={12} /> Remove from my notes</DropdownMenuItem>}
                  {!shared && note && <NoteKindMenuItem kind={note.kind} onChange={kind => updateNote.mutate({ id: note.id, kind })} />}
                </EntityActionsMenu>
            </div>
            {team && <div className="basis-full"><TeamAudience /></div>}
          </EntityDetailHeader>

          {/* Editor area + Chat */}
          {view === 'agent' && note ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
              <EntityAgentView
                entityType="note"
                entityId={note.id}
                chat={chat}
                onOpenDocument={() => setView('editor')}
              />
            </div>
          ) : (
          <div className="flex-1 flex overflow-hidden relative">
            {/* Main content */}
            <div className="flex-1 overflow-y-auto min-w-0 relative">
              {note && shared ? (
                <SharedNoteBody note={note} />
              ) : note ? (
                <>
                  <EntityChangeBanner entityType="note" entityId={note.id} />
                  <div className="px-4 md:px-12 py-0 flex items-center gap-2">
                    <NoteKindHeading kind={note.kind} />
                    <span className="text-muted-foreground/30">·</span>
                    {team ? <TeamAreaSelect value={note.areaId} onChange={handleAreaChange} /> : <AreaSelect value={note.areaId} onChange={handleAreaChange} />}
                  </div>
                  <div className="px-4 md:px-12">
                    {team && <SharedBodyState shared={sharedBody} />}
                    {(!team || sharedBody.ready) && <NoteEditor
                      key={team ? `${note.id}:${sharedBody.editorKey}` : note.id}
                      title={note.title ?? ''}
                      body={team ? sharedBody.initial : note.body}
                      onTitleChange={handleTitleChange}
                      onBodyChange={team ? sharedBody.edit : handleBodyChange}
                      applyExternalContent={team ? sharedBody.applyExternalContent : undefined}
                      onAttachment={team ? sharedBody.onAttachment : handleAttachment}
                      foldedHeadings={team ? undefined : note.foldedHeadings ?? []}
                      onFoldedHeadingsChange={team ? undefined : handleFoldedHeadingsChange}
                      autoFocusTitle={!note.title && note.body.trim().length === 0}
                      hideFooter
                      disabled={aiBusy}
                      metadata={
                        <p className="text-[10px] text-muted-foreground/50 mt-1">
                          Created {new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {note.updatedAt !== note.createdAt && (
                            <> &middot; Edited {new Date(note.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                          )}
                          <> &middot; {wordCount} words &middot; {charCount} chars</>
                        </p>
                      }
                    />}
                  </div>
                  <div className="px-4 md:px-12 pb-8">
                    <LinkedReferences entityType="note" entityId={note.id} />
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Loading...
                </div>
              )}
              {aiBusy && (
                <div className="absolute inset-0 bg-background/40 backdrop-blur-[1px] flex items-center justify-center pointer-events-auto transition-opacity duration-200">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground/80 bg-card/90 border border-border/50 rounded-full px-4 py-2 shadow-md">
                    <Pencil size={14} className="text-primary/70 animate-pulse" />
                    <span>AI is editing...</span>
                  </div>
                </div>
              )}
            </div>

            {/* AI Chat panel / bubble */}
            {!shared && !team && <SlideoutChat
              slideoutWidth={width}
              collapseThreshold={740}
              contextLabel="this note"
              chat={chat}
              disabled={!note}
            />}
          </div>
          )}
        </div>
    </EntitySheet>
  )
}
