'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import {
  X, Trash2, MoreHorizontal, Archive, Check,
  Clock, Timer, Flame, Zap, Lock, Repeat, Sparkles,
  ChevronLeft, Maximize2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTask, useUpdateTask, useDeleteTask, useCompleteTask } from '@/hooks/use-tasks'
import { useDashboard } from '@/contexts/dashboard-context'
import { HOTKEYS, matchesHotkey } from '@/constants/commands'
import { RichEditor } from '@/components/editor/rich-editor'
import { SubtaskSection } from './subtask-section'
import { AreaSelect } from '@/components/shared/area-select'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { SlideoutChat, useDocumentChat } from '@/components/ai-elements/slideout-chat'
import { cn } from '@/lib/utils'
import type { Energy, Effort, Attachment } from '@/db/types'

const DEFAULT_WIDTH = 1200
const MIN_WIDTH = 420
const MAX_WIDTH = 1400

const ENERGY_OPTIONS: { value: Energy; label: string; icon: typeof Flame; color: string }[] = [
  { value: 'deep', label: 'Deep', icon: Flame, color: 'text-orange-500' },
  { value: 'light', label: 'Light', icon: Zap, color: 'text-sky-400' },
]

const EFFORT_OPTIONS: { value: Effort; label: string }[] = [
  { value: 'trivial', label: 'XS — Trivial' },
  { value: 'small', label: 'S — Small' },
  { value: 'medium', label: 'M — Medium' },
  { value: 'large', label: 'L — Large' },
  { value: 'epic', label: 'XL — Epic' },
]

interface TaskSlideoutProps {
  taskId: string | null
  onClose: () => void
  onCloseAll: () => void
  hasHistory: boolean
}

export function TaskSlideout({ taskId, onClose, onCloseAll, hasHistory }: TaskSlideoutProps) {
  const isOpen = taskId !== null
  const { data: task } = useTask(taskId)
  const { data: parentTask } = useTask(task?.parent_id ?? null)
  const { openTask } = useDashboard()
  const router = useRouter()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const completeTask = useCompleteTask()
  const chat = useDocumentChat('task', task ?? null)
  const aiBusy = chat.status === 'streaming' || chat.status === 'submitted'

  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [editingDeadline, setEditingDeadline] = useState(false)
  const [editingBoomerang, setEditingBoomerang] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  // Auto-size title textarea when task loads, focus title if new
  useEffect(() => {
    if (task && titleRef.current) {
      const isNew = !task.title?.trim() && !task.body
      titleRef.current.value = isNew ? '' : task.title
      titleRef.current.style.height = 'auto'
      titleRef.current.style.height = titleRef.current.scrollHeight + 'px'

      if (isNew) {
        titleRef.current.focus()
      }
    }
  }, [task?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync title when it changes externally (e.g. AI tool update)
  useEffect(() => {
    if (task && titleRef.current && document.activeElement !== titleRef.current) {
      if (titleRef.current.value !== task.title) {
        titleRef.current.value = task.title
        titleRef.current.style.height = 'auto'
        titleRef.current.style.height = titleRef.current.scrollHeight + 'px'
      }
    }
  }, [task?.title]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveField = useCallback(
    (field: string, value: unknown) => {
      if (!taskId) return
      updateTask.mutate({ id: taskId, [field]: value } as Parameters<typeof updateTask.mutate>[0])
    },
    [taskId, updateTask]
  )

  const handleTitleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const target = e.currentTarget
      target.style.height = 'auto'
      target.style.height = target.scrollHeight + 'px'
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
      titleTimerRef.current = setTimeout(() => {
        saveField('title', target.value.trim())
      }, 500)
    },
    [saveField]
  )

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        // Focus the tiptap body editor inside this slideout
        const editorEl = containerRef.current?.querySelector('.task-slideout-editor .rich-editor-body')
        if (editorEl instanceof HTMLElement) {
          editorEl.focus()
        }
      }
    },
    []
  )

  const handleBodyChange = useCallback(
    (markdown: string) => {
      if (!taskId) return
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current)
      bodyTimerRef.current = setTimeout(() => {
        const attachments = pendingAttachmentsRef.current
        updateTask.mutate({
          id: taskId,
          body: markdown || null,
          ...(attachments.length > 0 ? { attachments } : {}),
        } as Parameters<typeof updateTask.mutate>[0])
      }, 500)
    },
    [taskId, updateTask]
  )

  const handleComplete = useCallback(() => {
    if (!taskId || !task) return
    if (task.status === 'done') {
      updateTask.mutate({ id: taskId, status: 'active', completed_at: null } as Parameters<typeof updateTask.mutate>[0])
    } else {
      completeTask.mutate({ id: taskId })
    }
  }, [taskId, task, updateTask, completeTask])

  const handleArchive = useCallback(() => {
    if (!taskId) return
    updateTask.mutate({ id: taskId, status: 'archived' } as Parameters<typeof updateTask.mutate>[0])
    onClose()
  }, [taskId, updateTask, onClose])

  const handleDelete = useCallback(() => {
    if (!taskId) return
    deleteTask.mutate(taskId)
    onClose()
  }, [taskId, deleteTask, onClose])

  // Cleanup
  useEffect(() => {
    return () => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current)
    }
  }, [])

  // Cmd+Enter → open full page
  useEffect(() => {
    if (!isOpen || !taskId) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesHotkey(e, HOTKEYS.openFullPage)) {
        e.preventDefault()
        router.push(`/task/${taskId}`)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, taskId, router])

  const isDone = task?.status === 'done'

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return null
    const d = new Date(iso)
    const now = new Date()
    const diff = d.getTime() - now.getTime()
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
    if (days === 0) return 'Today'
    if (days === 1) return 'Tomorrow'
    if (days === -1) return 'Yesterday'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

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
          <Dialog.Title className="sr-only">Task</Dialog.Title>
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

            <div className="flex items-center gap-2">
              <a
                href={taskId ? `/task/${taskId}` : '#'}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) return
                  e.preventDefault()
                  if (taskId) router.push(`/task/${taskId}`)
                }}
                className="group/expand p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
                aria-label="Open full page"
              >
                <kbd className="hidden group-hover/expand:inline px-1.5 py-0.5 bg-muted rounded text-[9px] text-muted-foreground/60 font-sans">
                  {HOTKEYS.openFullPage.label}
                </kbd>
                <Maximize2 size={14} />
              </a>

              {task && (
                <button
                  onClick={handleComplete}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                    isDone
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'border border-border text-muted-foreground hover:text-foreground hover:bg-accent',
                  )}
                >
                  <Check size={12} />
                  {isDone ? 'Completed' : 'Complete'}
                </button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                    <MoreHorizontal size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
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

          {/* Body + Chat */}
          <div className="flex-1 flex overflow-hidden relative">
            {/* Main content */}
            <div className="flex-1 overflow-y-auto min-w-0 relative">
              {task ? (
                <div className="space-y-0">
                  {/* Type label + area / parent breadcrumb */}
                  <div className="pt-4 px-10">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold tracking-wide text-muted-foreground/60 uppercase">
                        {task.parent_id ? 'Subtask' : 'Task'}
                      </span>
                      <span className="text-muted-foreground/30">·</span>
                      <AreaSelect
                        value={task.area_id}
                        onChange={(areaId) => saveField('area_id', areaId)}
                      />
                    </div>
                    {task.parent_id && parentTask && (
                      <button
                        onClick={() => openTask(task.parent_id!)}
                        className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors group"
                      >
                        <ChevronLeft size={12} className="opacity-60 group-hover:opacity-100" />
                        <span className="truncate max-w-[300px]">{parentTask.title}</span>
                      </button>
                    )}
                  </div>
                  <div className="pt-1 px-10">
                    <textarea
                      ref={titleRef}
                      className={cn(
                        'w-full text-2xl font-bold leading-tight bg-transparent border-none outline-none resize-none overflow-hidden text-foreground placeholder:text-muted-foreground/40',
                        isDone && 'line-through text-muted-foreground',
                      )}
                      placeholder="Task title"
                      defaultValue={task.title}
                      onInput={handleTitleInput}
                      onKeyDown={handleTitleKeyDown}
                      disabled={aiBusy}
                      rows={1}
                      data-gramm="false"
                      data-gramm_editor="false"
                      data-enable-grammarly="false"
                    />
                    <p className="text-[10px] text-muted-foreground/50 mt-1">
                      Created {new Date(task.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {task.updated_at !== task.created_at && (
                        <> · Edited {new Date(task.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                      )}
                      {task.completed_at && (
                        <> · Completed {new Date(task.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                      )}
                    </p>
                  </div>

                  {/* Properties */}
                  <div className="px-10 pt-4 pb-2">
                    <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[12px] pb-4 border-b border-border">
                      {/* Status */}
                      <span className="text-muted-foreground font-medium">Status</span>
                      <span className={cn(
                        'capitalize font-medium',
                        task.status === 'done' && 'text-emerald-500',
                        task.status === 'archived' && 'text-muted-foreground',
                      )}>
                        {task.status}
                      </span>

                      {/* Energy */}
                      <span className="text-muted-foreground font-medium">Energy</span>
                      <div className="flex items-center gap-1">
                        {ENERGY_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => saveField('energy', task.energy === opt.value ? null : opt.value)}
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                              task.energy === opt.value
                                ? `${opt.color} bg-current/10 ring-1 ring-current/20`
                                : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted',
                            )}
                          >
                            <opt.icon size={10} />
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {/* Effort */}
                      <span className="text-muted-foreground font-medium">Effort</span>
                      <div className="flex items-center gap-1 flex-wrap">
                        {EFFORT_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => saveField('effort', task.effort === opt.value ? null : opt.value)}
                            className={cn(
                              'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                              task.effort === opt.value
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted',
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {/* Deadline */}
                      <span className="text-muted-foreground font-medium">Deadline</span>
                      <div>
                        {editingDeadline ? (
                          <input
                            type="date"
                            autoFocus
                            defaultValue={task.hard_deadline?.split('T')[0] ?? ''}
                            className="text-[12px] bg-card border border-border rounded px-2 py-1"
                            onBlur={(e) => {
                              setEditingDeadline(false)
                              const val = e.target.value
                              saveField('hard_deadline', val ? new Date(val).toISOString() : null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              if (e.key === 'Escape') setEditingDeadline(false)
                            }}
                          />
                        ) : (
                          <button
                            onClick={() => setEditingDeadline(true)}
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors hover:bg-muted',
                              task.hard_deadline && new Date(task.hard_deadline) < new Date()
                                ? 'text-destructive'
                                : 'text-muted-foreground',
                            )}
                          >
                            <Clock size={10} />
                            {formatDate(task.hard_deadline) ?? 'Set deadline'}
                          </button>
                        )}
                      </div>

                      {/* Resurface / Boomerang */}
                      <span className="text-muted-foreground font-medium">Resurface</span>
                      <div>
                        {editingBoomerang ? (
                          <input
                            type="date"
                            autoFocus
                            defaultValue={task.resurface_after?.split('T')[0] ?? ''}
                            className="text-[12px] bg-card border border-border rounded px-2 py-1"
                            onBlur={(e) => {
                              setEditingBoomerang(false)
                              const val = e.target.value
                              saveField('resurface_after', val ? new Date(val).toISOString() : null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              if (e.key === 'Escape') setEditingBoomerang(false)
                            }}
                          />
                        ) : (
                          <button
                            onClick={() => setEditingBoomerang(true)}
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted',
                            )}
                          >
                            <Timer size={10} />
                            {formatDate(task.resurface_after) ?? 'Set snooze'}
                          </button>
                        )}
                      </div>

                      {/* Recurrence */}
                      {task.recurrence && (
                        <>
                          <span className="text-muted-foreground font-medium">Recurrence</span>
                          <span className="inline-flex items-center gap-1 text-primary/60 font-medium">
                            <Repeat size={10} /> {task.recurrence}
                          </span>
                        </>
                      )}

                      {/* Blocked */}
                      {task.blocked_on && (
                        <>
                          <span className="text-muted-foreground font-medium">Blocked on</span>
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-amber-500 font-medium">
                              <Lock size={10} /> {task.blocked_on}
                            </span>
                            <button
                              onClick={() => {
                                saveField('blocked_on', null)
                                saveField('blocked_since', null)
                              }}
                              className="text-[10px] text-muted-foreground hover:text-foreground underline"
                            >
                              Unblock
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Subtasks */}
                  <SubtaskSection parentId={task.id} onOpenTask={openTask} />

                  {/* Body editor */}
                  <div className="px-10 pt-2 pb-8 task-slideout-editor">
                    <RichEditor
                      key={task.id}
                      content={task.body ?? ''}
                      onChange={handleBodyChange}
                      onAttachment={handleAttachment}
                      editable={!aiBusy}
                      placeholder="Add notes, details, or type '/' for commands..."
                      hideFooter
                    />
                  </div>

                </div>
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
              contextLabel="this task"
              chat={chat}
              disabled={!task}
            />
          </div>
        </div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
