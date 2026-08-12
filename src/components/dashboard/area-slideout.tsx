'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import {
  ChevronLeft, X, MoreHorizontal, Archive, RotateCcw,
  Check, FileText, CheckSquare, Plus,
} from 'lucide-react'
import { useArea, useUpdateArea } from '@/hooks/use-areas'
import { useTasks, useCreateTask } from '@/hooks/use-tasks'
import { useNotes, useCreateNote } from '@/hooks/use-notes'
import { useDashboard } from '@/contexts/dashboard-context'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { NoteIcon } from '@/components/shared/note-icon'
import { coverAttachmentUrl } from '@/lib/attachments/view'
import { cn } from '@/lib/utils'

const DEFAULT_WIDTH = 640
const MIN_WIDTH = 400
const MAX_WIDTH = 1000

interface AreaSlideoutProps {
  areaId: string | null
  onClose: () => void
  onCloseAll: () => void
  hasHistory: boolean
}

export function AreaSlideout({ areaId, onClose, onCloseAll, hasHistory }: AreaSlideoutProps) {
  const isOpen = areaId !== null
  const { data: area } = useArea(areaId)
  const { data: tasks = [] } = useTasks(areaId ? { areaId: areaId } : { areaId: '__none__' })
  const { data: notes = [] } = useNotes(areaId ? { areaId: areaId } : { areaId: '__none__' })
  const { openTask, openNote } = useDashboard()
  const updateArea = useUpdateArea()
  const createTask = useCreateTask()
  const createNote = useCreateNote()

  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [descValue, setDescValue] = useState('')
  const [addingTask, setAddingTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [newNoteTitle, setNewNoteTitle] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const descTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const taskInputRef = useRef<HTMLInputElement>(null)
  const noteInputRef = useRef<HTMLInputElement>(null)

  // Sync local state when area loads
  useEffect(() => {
    if (area) {
      setNameValue(area.name)
      setDescValue(area.description ?? '')
    }
  }, [area?.id, area?.name, area?.description])

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

  const saveName = useCallback(
    (value: string) => {
      setNameValue(value)
      if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
      nameTimerRef.current = setTimeout(() => {
        const trimmed = value.trim()
        if (trimmed && areaId && trimmed !== area?.name) {
          updateArea.mutate({ id: areaId, name: trimmed })
        }
      }, 500)
    },
    [areaId, area?.name, updateArea]
  )

  const saveDescription = useCallback(
    (value: string) => {
      setDescValue(value)
      if (descTimerRef.current) clearTimeout(descTimerRef.current)
      descTimerRef.current = setTimeout(() => {
        if (areaId && value !== (area?.description ?? '')) {
          updateArea.mutate({ id: areaId, description: value || undefined })
        }
      }, 500)
    },
    [areaId, area?.description, updateArea]
  )

  const handleArchive = useCallback(() => {
    if (!areaId) return
    updateArea.mutate({ id: areaId, status: 'archived' })
    onClose()
  }, [areaId, updateArea, onClose])

  const handleRestore = useCallback(() => {
    if (!areaId) return
    updateArea.mutate({ id: areaId, status: 'active' })
  }, [areaId, updateArea])

  const handleAddTask = useCallback(() => {
    const trimmed = newTaskTitle.trim()
    if (!trimmed || !areaId || createTask.isPending) return
    setNewTaskTitle('')
    createTask.mutate(
      { title: trimmed, rawInput: trimmed, areaId: areaId },
      { onSuccess: () => setTimeout(() => taskInputRef.current?.focus(), 50) }
    )
  }, [newTaskTitle, areaId, createTask])

  const handleAddNote = useCallback(() => {
    const trimmed = newNoteTitle.trim()
    if (!trimmed || !areaId || createNote.isPending) return
    setNewNoteTitle('')
    createNote.mutate(
      { title: trimmed, body: '', areaId: areaId },
      { onSuccess: () => setTimeout(() => noteInputRef.current?.focus(), 50) }
    )
  }, [newNoteTitle, areaId, createNote])

  // Cleanup
  useEffect(() => {
    return () => {
      if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
      if (descTimerRef.current) clearTimeout(descTimerRef.current)
    }
  }, [])

  const isArchived = area?.status === 'archived'
  const activeTasks = tasks.filter((t) => t.status !== 'archived')
  const doneTasks = activeTasks.filter((t) => t.status === 'done')
  const openTasks = activeTasks.filter((t) => t.status !== 'done')

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
          <Dialog.Title className="sr-only">Area</Dialog.Title>

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
            <div className="flex items-center justify-between px-4 h-11 flex-shrink-0 border-b border-border">
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

              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                      <MoreHorizontal size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {isArchived ? (
                      <DropdownMenuItem onClick={handleRestore} className="text-xs">
                        <RotateCcw size={12} className="mr-2" /> Restore
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={handleArchive} className="text-xs text-destructive">
                        <Archive size={12} className="mr-2" /> Archive
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {area ? (
                <div className="space-y-0">
                  {/* Area header */}
                  <div className="px-8 pt-4 pb-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold tracking-wide text-muted-foreground/60 uppercase">
                        Area
                      </span>
                      <span className="text-muted-foreground/30">·</span>
                      <button
                        onClick={() => {
                          if (!areaId || !area) return
                          const cycle = ['active', 'inactive'] as const
                          const idx = cycle.indexOf(area.status as typeof cycle[number])
                          const next = cycle[(idx + 1) % cycle.length]
                          updateArea.mutate({ id: areaId, status: next })
                        }}
                        className={cn(
                          'text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-md cursor-pointer transition-colors',
                          area?.status === 'active'
                            ? 'text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20'
                            : area?.status === 'inactive'
                              ? 'text-amber-500 bg-amber-500/10 hover:bg-amber-500/20'
                              : 'text-muted-foreground bg-muted hover:bg-muted/80'
                        )}
                      >
                        {area?.status}
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      {(() => {
                        const coverUrl = coverAttachmentUrl(area.attachments)
                        if (coverUrl) {
                          return (
                            <img
                              src={coverUrl}
                              alt=""
                              className="w-10 h-10 rounded-xl object-cover flex-shrink-0"
                            />
                          )
                        }
                        if (area.emoji) {
                          return <span className="text-2xl flex-shrink-0">{area.emoji}</span>
                        }
                        return null
                      })()}

                      <input
                        value={nameValue}
                        onChange={(e) => saveName(e.target.value)}
                        className="flex-1 text-xl font-bold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/40"
                        placeholder="Area name"
                      />
                    </div>

                    <textarea
                      value={descValue}
                      onChange={(e) => saveDescription(e.target.value)}
                      placeholder="What does this area cover?"
                      className="w-full text-sm bg-transparent border-none outline-none resize-none text-foreground/70 placeholder:text-muted-foreground/30 leading-relaxed"
                      rows={2}
                    />
                  </div>

                  {/* Stats bar */}
                  <div className="px-8 pb-4">
                    <div className="flex items-center gap-4 text-[11px] text-muted-foreground/60">
                      <span>{openTasks.length} open task{openTasks.length !== 1 ? 's' : ''}</span>
                      <span>{doneTasks.length} completed</span>
                      <span>{notes.length} note{notes.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>

                  {/* Tasks section */}
                  <div className="px-8 pb-6">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckSquare size={13} className="text-muted-foreground/50" />
                      <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                        Tasks
                      </h3>
                    </div>

                    <div className="space-y-0.5">
                      {openTasks.map((task) => (
                        <button
                          key={task.id}
                          onClick={() => openTask(task.id)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors hover:bg-card group"
                        >
                          <div className={cn(
                            'flex-shrink-0 w-3.5 h-3.5 rounded-full border',
                            'border-muted-foreground/30',
                          )} />
                          <span className="text-[12px] font-medium text-foreground truncate">
                            {task.title}
                          </span>
                          {task.hardDeadline && (
                            <span className={cn(
                              'ml-auto text-[9px] font-medium flex-shrink-0',
                              new Date(task.hardDeadline) < new Date()
                                ? 'text-destructive'
                                : 'text-muted-foreground/50'
                            )}>
                              {new Date(task.hardDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </button>
                      ))}

                      {/* Inline add task */}
                      {addingTask ? (
                        <div className="flex items-center gap-2.5 px-3 py-1.5">
                          <div className="flex-shrink-0 w-3.5 h-3.5 rounded-full border border-dashed border-muted-foreground/30" />
                          <input
                            ref={taskInputRef}
                            autoFocus
                            value={newTaskTitle}
                            onChange={(e) => setNewTaskTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddTask()
                              if (e.key === 'Escape') { setAddingTask(false); setNewTaskTitle('') }
                            }}
                            onBlur={() => { setAddingTask(false); setNewTaskTitle('') }}
                            placeholder="Task title..."
                            className="flex-1 text-[12px] bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/40"
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddingTask(true)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left text-muted-foreground/40 hover:text-muted-foreground transition-colors hover:bg-card"
                        >
                          <Plus size={12} />
                          <span className="text-[11px]">Add task</span>
                        </button>
                      )}

                      {doneTasks.length > 0 && (
                        <>
                          <div className="pt-2 pb-1 pl-3">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40">
                              Completed ({doneTasks.length})
                            </span>
                          </div>
                          {doneTasks.map((task) => (
                            <button
                              key={task.id}
                              onClick={() => openTask(task.id)}
                              className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-left transition-colors hover:bg-card opacity-50"
                            >
                              <div className="flex-shrink-0 w-3.5 h-3.5 rounded-full bg-primary border border-primary flex items-center justify-center">
                                <Check size={8} strokeWidth={3} className="text-primary-foreground" />
                              </div>
                              <span className="text-[12px] font-medium text-muted-foreground line-through truncate">
                                {task.title}
                              </span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Notes section */}
                  <div className="px-8 pb-8">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText size={13} className="text-muted-foreground/50" />
                      <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                        Notes
                      </h3>
                    </div>

                    <div className="space-y-0.5">
                      {notes.map((note) => (
                        <button
                          key={note.id}
                          onClick={() => openNote(note.id)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors hover:bg-card"
                        >
                          <NoteIcon body={note.bodyExcerpt} size={13} className="text-muted-foreground/40 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <span className="text-[12px] font-medium text-foreground truncate block">
                              {note.title || 'Untitled'}
                            </span>
                            {note.bodyExcerpt && (
                              <span className="text-[10px] text-muted-foreground/50 truncate block">
                                {note.bodyExcerpt.replace(/[#*_~`>\-\[\]()]/g, '').slice(0, 80)}
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] text-muted-foreground/40 flex-shrink-0">
                            {new Date(note.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </button>
                      ))}

                      {/* Inline add note */}
                      {addingNote ? (
                        <div className="flex items-center gap-2.5 px-3 py-1.5">
                          <FileText size={13} className="text-muted-foreground/20 flex-shrink-0" />
                          <input
                            ref={noteInputRef}
                            autoFocus
                            value={newNoteTitle}
                            onChange={(e) => setNewNoteTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddNote()
                              if (e.key === 'Escape') { setAddingNote(false); setNewNoteTitle('') }
                            }}
                            onBlur={() => { setAddingNote(false); setNewNoteTitle('') }}
                            placeholder="Note title..."
                            className="flex-1 text-[12px] bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/40"
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddingNote(true)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left text-muted-foreground/40 hover:text-muted-foreground transition-colors hover:bg-card"
                        >
                          <Plus size={12} />
                          <span className="text-[11px]">Add note</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Loading...
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
