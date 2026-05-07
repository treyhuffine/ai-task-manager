'use client'

import { useState, useCallback, useRef } from 'react'
import { Check, ChevronRight, Plus, ArrowUpRight } from 'lucide-react'
import { useTasks, useCreateTask, useCompleteTask, useUpdateTask } from '@/hooks/use-tasks'
import { cn } from '@/lib/utils'

interface SubtaskSectionProps {
  parentId: string
  onOpenTask?: (id: string) => void
}

export function SubtaskSection({ parentId, onOpenTask }: SubtaskSectionProps) {
  const { data: subtasks } = useTasks({ parent_id: parentId })
  const createTask = useCreateTask()
  const completeTask = useCompleteTask()
  const updateTask = useUpdateTask()

  const [isExpanded, setIsExpanded] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const activeSubtasks = subtasks?.filter(t => t.status !== 'archived') ?? []
  const doneCount = activeSubtasks.filter(t => t.status === 'done').length
  const totalCount = activeSubtasks.length

  const handleAdd = useCallback(() => {
    if (!newTitle.trim()) {
      setIsAdding(false)
      return
    }
    createTask.mutate({
      title: newTitle.trim(),
      raw_input: newTitle.trim(),
      parent_id: parentId,
    })
    setNewTitle('')
    // Keep input focused for rapid entry
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [newTitle, parentId, createTask])

  const handleToggleComplete = useCallback((id: string, currentStatus: string) => {
    if (currentStatus === 'done') {
      updateTask.mutate({ id, status: 'active', completed_at: null } as Parameters<typeof updateTask.mutate>[0])
    } else {
      completeTask.mutate({ id })
    }
  }, [completeTask, updateTask])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
    if (e.key === 'Escape') {
      setIsAdding(false)
      setNewTitle('')
    }
  }, [handleAdd])

  return (
    <div className="px-4 md:px-10 py-3">
      {/* Header row: chevron + label + count + add button */}
      <div className="flex items-center gap-2 mb-1">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
        >
          <ChevronRight
            size={12}
            className={cn(
              'transition-transform duration-150',
              isExpanded && 'rotate-90',
            )}
          />
          Subtasks
          {totalCount > 0 && (
            <span className="text-[10px] font-medium text-muted-foreground/60 normal-case tracking-normal">
              {doneCount}/{totalCount}
            </span>
          )}
        </button>

        <div className="flex-1" />

        <button
          onClick={() => {
            setIsAdding(true)
            setIsExpanded(true)
            setTimeout(() => inputRef.current?.focus(), 50)
          }}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
        >
          <Plus size={12} />
          New
        </button>
      </div>

      {/* Subtask list */}
      {isExpanded && (
        <div className="space-y-0.5">
          {activeSubtasks.map((subtask) => {
            const isDone = subtask.status === 'done'
            return (
              <div
                key={subtask.id}
                className="group flex items-center gap-2 py-1.5 px-1 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => onOpenTask?.(subtask.id)}
              >
                {/* Checkbox */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleToggleComplete(subtask.id, subtask.status)
                  }}
                  className={cn(
                    'flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center transition-all',
                    isDone
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-muted-foreground/40 hover:border-primary hover:bg-primary/10',
                  )}
                >
                  {isDone && <Check size={10} strokeWidth={3} />}
                </button>

                {/* Title */}
                <span className={cn(
                  'text-[12px] flex-1 truncate',
                  isDone && 'line-through text-muted-foreground',
                )}>
                  {subtask.title}
                </span>

                {/* Open indicator */}
                <ArrowUpRight
                  size={12}
                  className="flex-shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors"
                />
              </div>
            )
          })}

          {/* Inline add input */}
          {isAdding && (
            <div className="flex items-center gap-2 py-1.5 px-1">
              <div className="flex-shrink-0 w-4 h-4 rounded-full border border-muted-foreground/20" />
              <input
                ref={inputRef}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleAdd}
                placeholder="Subtask title..."
                className="flex-1 text-[12px] bg-transparent outline-none placeholder:text-muted-foreground/40"
                autoFocus
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
