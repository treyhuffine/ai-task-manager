'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { ChevronLeft, X, Trash2, MoreHorizontal, ExternalLink, Archive, Sparkles, Maximize2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { NoteEditor } from '@/components/editor/rich-editor'
import { useNote, useUpdateNote, useDeleteNote } from '@/hooks/use-notes'
import { HOTKEYS, matchesHotkey } from '@/constants/commands'
import { AreaSelect } from '@/components/shared/area-select'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { SlideoutChat, useDocumentChat } from '@/components/ai-elements/slideout-chat'
import { useDragResize } from '@/hooks/use-drag-resize'
import { ReferencingSessionsButton } from '@/components/shared/referencing-sessions-button'
import { cn } from '@/lib/utils'
import type { Attachment } from '@/db/types'

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
  const isOpen = noteId !== null
  const { data: note } = useNote(noteId ?? '')
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()
  const router = useRouter()
  const chat = useDocumentChat('note', note ?? null)
  const aiBusy = chat.status === 'streaming' || chat.status === 'submitted'

  const { size: width, isResizing, handleResizeStart } = useDragResize({
    edge: 'left',
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    defaultSize: DEFAULT_WIDTH,
    storageKey: 'flow.note-slideout.width',
  })
  const [isVisible, setIsVisible] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const foldedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks attachments uploaded during this editing session so we can include
  // their metadata in save payloads. The server's derive step intersects these
  // with body-referenced file_names — uploads that never land in the body get
  // garbage-collected later by the reconciler.
  const pendingAttachmentsRef = useRef<Attachment[]>([])

  const handleAttachment = useCallback((attachment: Attachment) => {
    pendingAttachmentsRef.current = [...pendingAttachmentsRef.current, attachment]
  }, [])

  // Animate in
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true))
      })
    } else {
      setIsVisible(false)
    }
  }, [isOpen])

  // Debounced save — separate timers so title and body don't cancel each other
  const handleTitleChange = useCallback(
    (title: string) => {
      if (!noteId) return
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
      titleTimerRef.current = setTimeout(() => {
        updateNote.mutate({ id: noteId, title })
      }, 500)
    },
    [noteId, updateNote]
  )

  const handleBodyChange = useCallback(
    (body: string) => {
      if (!noteId) return
      // Update word/char counts from the body text
      const text = body.replace(/[#*_~`>\-\[\]()]/g, '').trim()
      setWordCount(text ? text.split(/\s+/).length : 0)
      setCharCount(body.length)

      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current)
      bodyTimerRef.current = setTimeout(() => {
        const attachments = pendingAttachmentsRef.current
        updateNote.mutate({
          id: noteId,
          body,
          ...(attachments.length > 0 ? { attachments } : {}),
        })
      }, 500)
    },
    [noteId, updateNote]
  )

  // Initialize counts when note loads
  useEffect(() => {
    if (note) {
      const text = note.body.replace(/[#*_~`>\-\[\]()]/g, '').trim()
      setWordCount(text ? text.split(/\s+/).length : 0)
      setCharCount(note.body.length)
    }
  }, [note?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFoldedHeadingsChange = useCallback(
    (folded: string[]) => {
      if (!noteId) return
      if (foldedTimerRef.current) clearTimeout(foldedTimerRef.current)
      foldedTimerRef.current = setTimeout(() => {
        updateNote.mutate({ id: noteId, foldedHeadings: folded })
      }, 400)
    },
    [noteId, updateNote]
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

  const handleDelete = useCallback(() => {
    if (!noteId) return
    deleteNote.mutate(noteId)
    onClose()
  }, [noteId, deleteNote, onClose])

  // Cmd+Enter → open full page
  useEffect(() => {
    if (!isOpen || !noteId) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesHotkey(e, HOTKEYS.openFullPage)) {
        e.preventDefault()
        router.push(`/note/${noteId}`)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, noteId, router])

  // Cleanup save timers
  useEffect(() => {
    return () => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current)
      if (foldedTimerRef.current) clearTimeout(foldedTimerRef.current)
    }
  }, [])

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onCloseAll() }}>
      <Dialog.Portal>
        {/* Overlay — clicking closes everything */}
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-black/30 transition-opacity duration-150',
            isVisible ? 'opacity-100' : 'opacity-0'
          )}
        />

        {/* Slideout panel */}
        <Dialog.Content
          ref={containerRef}
          className={cn(
            'fixed top-0 right-0 bottom-0 z-50 flex transition-transform duration-150 ease-out outline-none',
            isVisible ? 'translate-x-0' : 'translate-x-full'
          )}
          style={{ width: `min(${width}px, 100vw)` }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => { if (isResizing) e.preventDefault() }}
          onEscapeKeyDown={(e) => {
            e.preventDefault()
            if (e.shiftKey) onCloseAll()
            else onClose()
          }}
        >
          <Dialog.Title className="sr-only">Note</Dialog.Title>
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
          <div className="flex items-center justify-between px-4 h-11 flex-shrink-0">
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

            <div className="flex items-center gap-3">
              {noteId && <ReferencingSessionsButton entityType="note" entityId={noteId} />}
              <a
                href={noteId ? `/note/${noteId}` : '#'}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) return
                  e.preventDefault()
                  if (noteId) router.push(`/note/${noteId}`)
                }}
                className="group/expand p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
                aria-label="Open full page"
              >
                <kbd className="hidden group-hover/expand:inline px-1.5 py-0.5 bg-muted rounded text-[9px] text-muted-foreground/60 font-sans">
                  {HOTKEYS.openFullPage.label}
                </kbd>
                <Maximize2 size={14} />
              </a>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                    <MoreHorizontal size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {note?.url && (
                    <>
                      <DropdownMenuItem asChild className="text-xs">
                        <a href={note.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink size={12} className="mr-2" /> Open link
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={handleArchive} className="text-xs">
                    <Archive size={12} className="mr-2" /> Archive
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDelete} className="text-xs text-destructive">
                    <Trash2 size={12} className="mr-2" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Editor area + Chat */}
          <div className="flex-1 flex overflow-hidden relative">
            {/* Main content */}
            <div className="flex-1 overflow-y-auto min-w-0 relative">
              {note ? (
                <>
                  <div className="px-4 md:px-12 py-0 flex items-center gap-2">
                    <span className="text-[10px] font-bold tracking-wide text-muted-foreground/60 uppercase">Note</span>
                    <span className="text-muted-foreground/30">·</span>
                    <AreaSelect
                      value={note.areaId}
                      onChange={handleAreaChange}
                    />
                  </div>
                  <div className="px-4 md:px-12">
                    <NoteEditor
                      key={note.id}
                      title={note.title ?? ''}
                      body={note.body}
                      onTitleChange={handleTitleChange}
                      onBodyChange={handleBodyChange}
                      onAttachment={handleAttachment}
                      foldedHeadings={note.foldedHeadings ?? []}
                      onFoldedHeadingsChange={handleFoldedHeadingsChange}
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
                    />
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
                    <Sparkles size={14} className="text-primary/70 animate-pulse" />
                    <span>AI is editing...</span>
                  </div>
                </div>
              )}
            </div>

            {/* AI Chat panel / bubble */}
            <SlideoutChat
              slideoutWidth={width}
              collapseThreshold={740}
              contextLabel="this note"
              chat={chat}
              disabled={!note}
            />
          </div>
        </div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
