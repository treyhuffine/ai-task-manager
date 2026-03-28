'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { X, Trash2, MoreHorizontal, ExternalLink, Archive } from 'lucide-react'
import { NoteEditor } from '@/components/editor/rich-editor'
import { useNote, useUpdateNote, useDeleteNote } from '@/hooks/use-notes'
import { AreaSelect } from '@/components/shared/area-select'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { SlideoutChat } from '@/components/ai-elements/slideout-chat'
import { cn } from '@/lib/utils'

const DEFAULT_WIDTH = 1000
const MIN_WIDTH = 420
const MAX_WIDTH = 1400

interface NoteSlideoutProps {
  noteId: string | null
  onClose: () => void
}

export function NoteSlideout({ noteId, onClose }: NoteSlideoutProps) {
  const isOpen = noteId !== null
  const { data: note } = useNote(noteId ?? '')
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()

  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Escape to close
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

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

  // Debounced save
  const handleTitleChange = useCallback(
    (title: string) => {
      if (!noteId) return
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
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

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
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

  // Cleanup save timer
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  if (!isOpen) return null

  return (
    <>
      {/* Overlay */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/30 transition-opacity duration-150',
          isVisible ? 'opacity-100' : 'opacity-0'
        )}
        onClick={onClose}
        aria-hidden
      />

      {/* Slideout panel */}
      <div
        ref={containerRef}
        className={cn(
          'fixed top-0 right-0 bottom-0 z-50 flex transition-transform duration-150 ease-out',
          isVisible ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{ width: `min(${width}px, 100vw)` }}
      >
        {/* Resize handle */}
        <div
          className={cn(
            'w-1.5 cursor-col-resize flex-shrink-0 group relative',
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
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>

              {note && (
                <AreaSelect
                  value={note.area_id}
                  onChange={handleAreaChange}
                />
              )}
            </div>

            <div className="flex items-center gap-3">
              {note && (
                <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                  {wordCount} words · {charCount} chars
                  {note.updated_at && (
                    <> · Edited {new Date(note.updated_at).toLocaleDateString()}</>
                  )}
                </span>
              )}

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
            <div className="flex-1 overflow-y-auto min-w-0">
              {note ? (
                <>
                  <div className="px-16 py-0">
                    <span className="text-[10px] font-bold tracking-wide text-muted-foreground/60 uppercase">Note</span>
                  </div>
                  <NoteEditor
                    key={note.id}
                    title={note.title ?? ''}
                    body={note.body}
                    onTitleChange={handleTitleChange}
                    onBodyChange={handleBodyChange}
                    autoFocusTitle={!note.title && note.body.trim().length === 0}
                    hideFooter
                  />
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Loading...
                </div>
              )}
            </div>

            {/* AI Chat panel / bubble */}
            <SlideoutChat
              slideoutWidth={width}
              collapseThreshold={740}
              contextLabel="this note"
            />
          </div>
        </div>
      </div>
    </>
  )
}
