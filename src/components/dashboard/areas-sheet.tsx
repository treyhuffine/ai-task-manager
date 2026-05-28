'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { X, Plus, GripVertical } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import { useAreas, useUpdateArea } from '@/hooks/use-areas'
import { useDashboard } from '@/contexts/dashboard-context'
import { AreaCreateModal } from '@/components/dashboard/area-create-modal'
import type { AreaRecord } from '@/db/types'
import { coverAttachmentUrl } from '@/lib/attachments/view'
import { cn } from '@/lib/utils'

const DEFAULT_WIDTH = 560
const MIN_WIDTH = 380
const MAX_WIDTH = 800

interface AreasSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function SortableAreaRow({ area, onOpen }: { area: AreaRecord; onOpen: (id: string) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: area.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const isArchived = area.status === 'archived'
  const coverUrl = coverAttachmentUrl(area.attachments)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group border-b border-border last:border-b-0 transition-colors hover:bg-muted/20 cursor-pointer',
        isArchived && 'opacity-60',
        isDragging && 'opacity-50 z-50 bg-background shadow-lg'
      )}
      onClick={() => onOpen(area.id)}
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          className="touch-none p-0.5 rounded text-muted-foreground/30 hover:text-muted-foreground transition-colors cursor-grab active:cursor-grabbing flex-shrink-0"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={12} />
        </button>

        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            className="w-7 h-7 rounded-lg object-cover flex-shrink-0"
          />
        ) : area.emoji ? (
          <span className="text-lg flex-shrink-0">
            {area.emoji}
          </span>
        ) : null}

        <div className="flex-1 min-w-0">
          <span className={cn(
            'text-sm font-medium text-foreground truncate block',
            isArchived && 'line-through text-muted-foreground'
          )}>
            {area.name}
          </span>
          {area.description && (
            <span className="text-[10px] text-muted-foreground/60 truncate block">
              {area.description}
            </span>
          )}
        </div>

        <span className={cn(
          'text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-md flex-shrink-0',
          area.status === 'active'
            ? 'text-emerald-500 bg-emerald-500/10'
            : area.status === 'inactive'
              ? 'text-amber-500 bg-amber-500/10'
              : 'text-muted-foreground bg-muted'
        )}>
          {area.status}
        </span>
      </div>
    </div>
  )
}

export function AreasSheet({ open, onOpenChange }: AreasSheetProps) {
  const { data: areas = [] } = useAreas({ status: 'all' })
  const { openArea } = useDashboard()
  const updateArea = useUpdateArea()
  const queryClient = useQueryClient()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const activeAreas = areas.filter((a) => a.status !== 'archived')
  const archivedAreas = areas.filter((a) => a.status === 'archived')
  const displayedAreas = showArchived ? areas : activeAreas

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = displayedAreas.findIndex((a) => a.id === active.id)
    const newIndex = displayedAreas.findIndex((a) => a.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove([...displayedAreas], oldIndex, newIndex)

    // Optimistic update in cache
    queryClient.setQueryData(
      ['areas', { status: 'all' }],
      (prev: AreaRecord[] | undefined) => {
        if (!prev) return prev
        // Build a full list preserving any items not in displayedAreas
        const reorderedIds = new Set(reordered.map((a) => a.id))
        const others = prev.filter((a) => !reorderedIds.has(a.id))
        return [...reordered.map((a, i) => ({ ...a, sortOrder: i })), ...others]
      }
    )

    // Persist new sortOrder for each moved item
    reordered.forEach((area, i) => {
      if (area.sortOrder !== i) {
        updateArea.mutate({ id: area.id, sortOrder: i })
      }
    })
  }, [displayedAreas, queryClient, updateArea])

  // Animate in
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true))
      })
    } else {
      setIsVisible(false)
    }
  }, [open])

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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Overlay */}
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
            onOpenChange(false)
          }}
        >
          <Dialog.Title className="sr-only">Areas</Dialog.Title>

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
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onOpenChange(false)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
                <span className="text-[10px] font-bold tracking-wide text-muted-foreground/60 uppercase">
                  Areas
                </span>
              </div>

              <button
                onClick={() => setCreateModalOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors"
              >
                <Plus size={12} />
                New
              </button>
            </div>

            {/* Area list */}
            <div className="flex-1 overflow-y-auto">
              {displayedAreas.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                  <p className="text-[11px]">No areas yet</p>
                  <button
                    onClick={() => setCreateModalOpen(true)}
                    className="text-[11px] text-primary hover:underline"
                  >
                    Create your first area
                  </button>
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={displayedAreas.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                    <div>
                      {displayedAreas.map((area) => (
                        <SortableAreaRow key={area.id} area={area} onOpen={(id) => openArea(id)} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>

            {/* Footer */}
            {archivedAreas.length > 0 && (
              <div className="flex-shrink-0 border-t border-border px-4 py-2">
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  {showArchived
                    ? 'Hide archived'
                    : `Show ${archivedAreas.length} archived`}
                </button>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      <AreaCreateModal open={createModalOpen} onOpenChange={setCreateModalOpen} />
    </Dialog.Root>
  )
}
