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
import { cn } from '@/lib/utils'

const DEFAULT_WIDTH = 1000
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

  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Drag to resize
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizing(true)
      const startX = e.clientX
      const startWidth = width

      const handleMouseMove = (e: MouseEvent) => {
        const delta = startX - e.clientX
        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta))
        setWidth(newWidth)
      }

      const handleMouseUp = () => {
        setIsResizing(false)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [width]
  )

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
        updateNote.mutate({ id: noteId, body })
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

  const handleAreaChange = useCallback(
    (areaId: string | null) => {
      if (!noteId) return
      updateNote.mutate({ id: noteId, area_id: areaId })
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
          onMouseDown={handleResizeStart}
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
                  <div className="px-16 py-0 flex items-center gap-2">
                    <span className="text-[10px] font-bold tracking-wide text-muted-foreground/60 uppercase">Note</span>
                    <span className="text-muted-foreground/30">·</span>
                    <AreaSelect
                      value={note.area_id}
                      onChange={handleAreaChange}
                    />
                  </div>
                  <NoteEditor
                    key={note.id}
                    title={note.title ?? ''}
                    body={note.body}
                    onTitleChange={handleTitleChange}
                    onBodyChange={handleBodyChange}
                    autoFocusTitle={!note.title && note.body.trim().length === 0}
                    hideFooter
                    disabled={aiBusy}
                    metadata={
                      <p className="text-[10px] text-muted-foreground/50 mt-1">
                        Created {new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {note.updated_at !== note.created_at && (
                          <> &middot; Edited {new Date(note.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                        )}
                        <> &middot; {wordCount} words &middot; {charCount} chars</>
                      </p>
                    }
                  />
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
