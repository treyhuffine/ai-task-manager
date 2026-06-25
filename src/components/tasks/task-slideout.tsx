'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import {
  X,
  Trash2,
  MoreHorizontal,
  Archive,
  Check,
  Clock,
  Timer,
  Flame,
  Zap,
  Lock,
  Repeat,
  Sparkles,
  ChevronLeft,
  ChevronDown,
  Maximize2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useTask,
  useTasks,
  useUpdateTask,
  useDeleteTask,
  useCompleteTask,
} from '@/hooks/use-tasks';
import { useQueryClient } from '@tanstack/react-query';
import { useDashboard } from '@/contexts/dashboard-context';
import { tasksApi } from '@/lib/api/tasks';
import { BUCKET_OPTIONS, computeBucketPlacement, type Bucket } from '@/lib/utils/bucket-placement';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { RichEditor } from '@/components/editor/rich-editor';
import { SubtaskSection } from './subtask-section';
import { AreaSelect } from '@/components/shared/area-select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { SlideoutChat, useDocumentChat } from '@/components/ai-elements/slideout-chat';
import { useDragResize } from '@/hooks/use-drag-resize';
import { ReferencingSessionsButton } from '@/components/shared/referencing-sessions-button';
import { EntityHistoryButton } from '@/components/entities/entity-history-button';
import { EntityChangeBanner } from '@/components/entities/entity-change-banner';
import { cn } from '@/lib/utils';
import type { Energy, Effort, Attachment } from '@/db/types';

const DEFAULT_WIDTH = 1200;
const MIN_WIDTH = 420;
const MAX_WIDTH = 1400;

const ENERGY_OPTIONS: { value: Energy; label: string; icon: typeof Flame; color: string }[] = [
  { value: 'deep', label: 'Deep', icon: Flame, color: 'text-orange-500' },
  { value: 'light', label: 'Light', icon: Zap, color: 'text-sky-400' },
];

const EFFORT_OPTIONS: { value: Effort; label: string }[] = [
  { value: 'trivial', label: 'XS: Trivial' },
  { value: 'small', label: 'S: Small' },
  { value: 'medium', label: 'M: Medium' },
  { value: 'large', label: 'L: Large' },
  { value: 'epic', label: 'XL: Epic' },
];

interface TaskSlideoutProps {
  taskId: string | null;
  onClose: () => void;
  onCloseAll: () => void;
  hasHistory: boolean;
}

export function TaskSlideout({ taskId, onClose, onCloseAll, hasHistory }: TaskSlideoutProps) {
  const isOpen = taskId !== null;
  const { data: task } = useTask(taskId);
  const { data: parentTask } = useTask(task?.parentId ?? null);
  const { openTask } = useDashboard();
  const router = useRouter();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const completeTask = useCompleteTask();
  const chat = useDocumentChat('task', task ?? null);
  const aiBusy = chat.status === 'streaming' || chat.status === 'submitted';

  // Global priority-ordered list, used to compute bucket placement and the position readout.
  const priorityFilter = { status: 'active' as const, orderBy: 'sortKey' as const };
  const { data: priorityList } = useTasks(priorityFilter);
  const queryClient = useQueryClient();

  const { size: width, isResizing, handleResizeStart } = useDragResize({
    edge: 'left',
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    defaultSize: DEFAULT_WIDTH,
    storageKey: 'flow.task-slideout.width',
  });
  const [isVisible, setIsVisible] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [editingBoomerang, setEditingBoomerang] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAttachmentsRef = useRef<Attachment[]>([]);

  const handleAttachment = useCallback((attachment: Attachment) => {
    pendingAttachmentsRef.current = [...pendingAttachmentsRef.current, attachment];
  }, []);

  // Animate in
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true));
      });
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  // Auto-size title textarea when task loads, focus title if new
  useEffect(() => {
    if (task && titleRef.current) {
      const isNew = !task.title?.trim() && !task.body;
      titleRef.current.value = isNew ? '' : task.title;
      titleRef.current.style.height = 'auto';
      titleRef.current.style.height = titleRef.current.scrollHeight + 'px';

      if (isNew) {
        titleRef.current.focus();
      }
    }
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync title when it changes externally (e.g. AI tool update)
  useEffect(() => {
    if (task && titleRef.current && document.activeElement !== titleRef.current) {
      if (titleRef.current.value !== task.title) {
        titleRef.current.value = task.title;
        titleRef.current.style.height = 'auto';
        titleRef.current.style.height = titleRef.current.scrollHeight + 'px';
      }
    }
  }, [task?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveField = useCallback(
    (field: string, value: unknown) => {
      if (!taskId) return;
      updateTask.mutate({ id: taskId, [field]: value } as Parameters<typeof updateTask.mutate>[0]);
    },
    [taskId, updateTask],
  );

  const handlePickBucket = useCallback(
    (bucket: Bucket) => {
      if (!taskId || !priorityList) return;
      const placement = computeBucketPlacement(priorityList, taskId, bucket);
      if (!placement) return;

      const priorityKey = ['tasks', priorityFilter];
      const previousData = queryClient.getQueryData(priorityKey);
      queryClient.setQueryData(priorityKey, placement.reordered);

      const allPatches = [...placement.normalizationPatches, placement.movedPatch];
      Promise.all(allPatches.map((p) => tasksApi.update(p.id, { sortKey: p.sortKey })))
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
        })
        .catch(() => {
          queryClient.setQueryData(priorityKey, previousData);
        });
    },
    [taskId, priorityList, queryClient, priorityFilter],
  );

  const positionInfo = (() => {
    if (!taskId || !priorityList || priorityList.length === 0) return null;
    const idx = priorityList.findIndex((t) => t.id === taskId);
    if (idx === -1) return null;
    return {
      index: idx,
      total: priorityList.length,
      hasKey: priorityList[idx].sortKey !== null,
    };
  })();

  const handleTitleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const target = e.currentTarget;
      target.style.height = 'auto';
      target.style.height = target.scrollHeight + 'px';
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      titleTimerRef.current = setTimeout(() => {
        saveField('title', target.value.trim());
      }, 500);
    },
    [saveField],
  );

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Focus the tiptap body editor inside this slideout
      const editorEl = containerRef.current?.querySelector(
        '.task-slideout-editor .rich-editor-body',
      );
      if (editorEl instanceof HTMLElement) {
        editorEl.focus();
      }
    }
  }, []);

  const handleBodyChange = useCallback(
    (markdown: string) => {
      if (!taskId) return;
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
      bodyTimerRef.current = setTimeout(() => {
        const attachments = pendingAttachmentsRef.current;
        updateTask.mutate({
          id: taskId,
          body: markdown || null,
          ...(attachments.length > 0 ? { attachments } : {}),
        } as Parameters<typeof updateTask.mutate>[0]);
      }, 500);
    },
    [taskId, updateTask],
  );

  const foldedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleFoldedHeadingsChange = useCallback(
    (folded: string[]) => {
      if (!taskId) return;
      if (foldedTimerRef.current) clearTimeout(foldedTimerRef.current);
      foldedTimerRef.current = setTimeout(() => {
        updateTask.mutate({ id: taskId, foldedHeadings: folded } as Parameters<
          typeof updateTask.mutate
        >[0]);
      }, 400);
    },
    [taskId, updateTask],
  );

  const handleComplete = useCallback(() => {
    if (!taskId || !task) return;
    if (task.status === 'done') {
      updateTask.mutate({ id: taskId, status: 'active', completedAt: null } as Parameters<
        typeof updateTask.mutate
      >[0]);
    } else {
      completeTask.mutate({ id: taskId });
    }
  }, [taskId, task, updateTask, completeTask]);

  const handleArchive = useCallback(() => {
    if (!taskId) return;
    updateTask.mutate({ id: taskId, status: 'archived' } as Parameters<
      typeof updateTask.mutate
    >[0]);
    onClose();
  }, [taskId, updateTask, onClose]);

  const handleDelete = useCallback(() => {
    if (!taskId) return;
    deleteTask.mutate(taskId);
    onClose();
  }, [taskId, deleteTask, onClose]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
      if (foldedTimerRef.current) clearTimeout(foldedTimerRef.current);
    };
  }, []);

  // Cmd+Enter → open full page
  useEffect(() => {
    if (!isOpen || !taskId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesHotkey(e, HOTKEYS.openFullPage)) {
        e.preventDefault();
        router.push(`/task/${taskId}`);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, taskId, router]);

  const isDone = task?.status === 'done';

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return null;
    const d = new Date(iso);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onCloseAll();
      }}
    >
      <Dialog.Portal>
        {/* Overlay — clicking closes everything */}
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-black/30 transition-opacity duration-150',
            isVisible ? 'opacity-100' : 'opacity-0',
          )}
        />

        {/* Slideout panel */}
        <Dialog.Content
          ref={containerRef}
          className={cn(
            'fixed top-0 right-0 bottom-0 z-50 flex transition-transform duration-150 ease-out outline-none',
            isVisible ? 'translate-x-0' : 'translate-x-full',
          )}
          style={{ width: `min(${width}px, 100vw)` }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (isResizing) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            if (e.shiftKey) onCloseAll();
            else onClose();
          }}
        >
          <Dialog.Title className="sr-only">Task</Dialog.Title>
          {/* Resize handle — desktop only */}
          <div
            className={cn(
              'hidden md:block w-1.5 cursor-col-resize flex-shrink-0 group relative',
              'hover:bg-primary/20 active:bg-primary/30 transition-colors',
              isResizing && 'bg-primary/30',
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

              <div className="flex items-center gap-2">
                {taskId && <EntityHistoryButton entityType="task" entityId={taskId} />}
                {taskId && <ReferencingSessionsButton entityType="task" entityId={taskId} />}
                <a
                  href={taskId ? `/task/${taskId}` : '#'}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) return;
                    e.preventDefault();
                    if (taskId) router.push(`/task/${taskId}`);
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
                    <EntityChangeBanner entityType="task" entityId={task.id} />
                    {/* Type label + area / parent breadcrumb */}
                    <div className="pt-4 px-4 md:px-12">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold tracking-wide text-muted-foreground/60 uppercase">
                          {task.parentId ? 'Subtask' : 'Task'}
                        </span>
                        <span className="text-muted-foreground/30">·</span>
                        <AreaSelect
                          value={task.areaId}
                          onChange={(areaId) => saveField('areaId', areaId)}
                        />
                      </div>
                      {task.parentId && parentTask && (
                        <button
                          onClick={() => openTask(task.parentId!)}
                          className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors group"
                        >
                          <ChevronLeft size={12} className="opacity-60 group-hover:opacity-100" />
                          <span className="truncate max-w-[300px]">{parentTask.title}</span>
                        </button>
                      )}
                    </div>
                    <div className="pt-1 px-4 md:px-12">
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
                        Created{' '}
                        {new Date(task.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                        {task.updatedAt !== task.createdAt && (
                          <>
                            {' '}
                            · Edited{' '}
                            {new Date(task.updatedAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </>
                        )}
                        {task.completedAt && (
                          <>
                            {' '}
                            · Completed{' '}
                            {new Date(task.completedAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </>
                        )}
                      </p>
                    </div>

                    {/* Properties */}
                    <div className="px-4 md:px-12 pt-4 pb-2">
                      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[12px] pb-4 border-b border-border">
                        {/* Status */}
                        <span className="text-muted-foreground font-medium">Status</span>
                        <span
                          className={cn(
                            'capitalize font-medium',
                            task.status === 'done' && 'text-emerald-500',
                            task.status === 'archived' && 'text-muted-foreground',
                          )}
                        >
                          {task.status}
                        </span>

                        {/* Energy */}
                        <span className="text-muted-foreground font-medium">Energy</span>
                        <div className="flex items-center gap-1">
                          {ENERGY_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() =>
                                saveField('energy', task.energy === opt.value ? null : opt.value)
                              }
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
                              onClick={() =>
                                saveField('effort', task.effort === opt.value ? null : opt.value)
                              }
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

                        {/* Priority — bucket is a gesture (one-time nudge), not state */}
                        <span className="text-muted-foreground font-medium">Priority</span>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-foreground/80 text-[12px] font-medium">
                              {!positionInfo
                                ? 'Loading…'
                                : positionInfo.hasKey
                                  ? `Ranked #${positionInfo.index + 1} of ${positionInfo.total}`
                                  : 'Not yet ranked'}
                            </span>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted border border-border transition-colors">
                                  {positionInfo?.hasKey ? 'Move' : 'Place'}
                                  <ChevronDown size={10} />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="w-32">
                                {BUCKET_OPTIONS.map((opt) => (
                                  <DropdownMenuItem
                                    key={opt.value}
                                    onClick={() => handlePickBucket(opt.value)}
                                    className="text-xs"
                                  >
                                    {opt.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <span className="text-[10px] text-muted-foreground/60 leading-snug">
                            Drop into a rough bucket so AI has a starting point for weighing this
                            against other tasks. The system can refine from there.
                          </span>
                        </div>

                        {/* Deadline */}
                        <span className="text-muted-foreground font-medium">Deadline</span>
                        <div>
                          {editingDeadline ? (
                            <input
                              type="date"
                              autoFocus
                              defaultValue={task.hardDeadline?.split('T')[0] ?? ''}
                              className="text-[12px] bg-card border border-border rounded px-2 py-1"
                              onBlur={(e) => {
                                setEditingDeadline(false);
                                const val = e.target.value;
                                saveField(
                                  'hardDeadline',
                                  val ? new Date(val).toISOString() : null,
                                );
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                if (e.key === 'Escape') setEditingDeadline(false);
                              }}
                            />
                          ) : (
                            <button
                              onClick={() => setEditingDeadline(true)}
                              className={cn(
                                'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors hover:bg-muted',
                                task.hardDeadline && new Date(task.hardDeadline) < new Date()
                                  ? 'text-destructive'
                                  : 'text-muted-foreground',
                              )}
                            >
                              <Clock size={10} />
                              {formatDate(task.hardDeadline) ?? 'Set deadline'}
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
                              defaultValue={task.resurfaceAfter?.split('T')[0] ?? ''}
                              className="text-[12px] bg-card border border-border rounded px-2 py-1"
                              onBlur={(e) => {
                                setEditingBoomerang(false);
                                const val = e.target.value;
                                saveField(
                                  'resurfaceAfter',
                                  val ? new Date(val).toISOString() : null,
                                );
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                if (e.key === 'Escape') setEditingBoomerang(false);
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
                              {formatDate(task.resurfaceAfter) ?? 'Set snooze'}
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
                        {task.blockedOn && (
                          <>
                            <span className="text-muted-foreground font-medium">Blocked on</span>
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-amber-500 font-medium">
                                <Lock size={10} /> {task.blockedOn}
                              </span>
                              <button
                                onClick={() => {
                                  saveField('blockedOn', null);
                                  saveField('blockedSince', null);
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
                    <div className="px-4 md:px-12 pt-2 pb-8 task-slideout-editor">
                      <RichEditor
                        key={task.id}
                        content={task.body ?? ''}
                        onChange={handleBodyChange}
                        onAttachment={handleAttachment}
                        editable={!aiBusy}
                        placeholder="Type '/' for commands..."
                        hideFooter
                        foldedHeadings={task.foldedHeadings ?? []}
                        onFoldedHeadingsChange={handleFoldedHeadingsChange}
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
  );
}
