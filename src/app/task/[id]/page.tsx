'use client';

import { use, useEffect, useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
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
} from 'lucide-react';
import { useTask, useUpdateTask, useDeleteTask, useCompleteTask } from '@/hooks/use-tasks';
import { SlideoutChat, useDocumentChat } from '@/components/ai-elements/slideout-chat';
import { RichEditor } from '@/components/editor/rich-editor';
import { SubtaskSection } from '@/components/tasks/subtask-section';
import { AreaSelect } from '@/components/shared/area-select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Energy, Effort, Attachment } from '@/db/types';

const ENERGY_OPTIONS: { value: Energy; label: string; icon: typeof Flame; color: string }[] = [
  { value: 'deep', label: 'Deep', icon: Flame, color: 'text-orange-500' },
  { value: 'light', label: 'Light', icon: Zap, color: 'text-sky-400' },
];

const EFFORT_OPTIONS: { value: Effort; label: string }[] = [
  { value: 'trivial', label: 'XS \u2014 Trivial' },
  { value: 'small', label: 'S \u2014 Small' },
  { value: 'medium', label: 'M \u2014 Medium' },
  { value: 'large', label: 'L \u2014 Large' },
  { value: 'epic', label: 'XL \u2014 Epic' },
];

export default function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = use(params);
  const router = useRouter();
  const { data: task } = useTask(taskId);
  const { data: parentTask } = useTask(task?.parent_id ?? null);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const completeTask = useCompleteTask();
  const chat = useDocumentChat('task', task ?? null);
  const aiBusy = chat.status === 'streaming' || chat.status === 'submitted';

  const [editingDeadline, setEditingDeadline] = useState(false);
  const [editingBoomerang, setEditingBoomerang] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAttachmentsRef = useRef<Attachment[]>([]);

  const handleAttachment = useCallback((attachment: Attachment) => {
    pendingAttachmentsRef.current = [...pendingAttachmentsRef.current, attachment];
  }, []);

  // Auto-size title textarea when task loads
  useEffect(() => {
    if (task && titleRef.current) {
      titleRef.current.value = task.title;
      titleRef.current.style.height = 'auto';
      titleRef.current.style.height = titleRef.current.scrollHeight + 'px';
    }
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync title when it changes externally
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
      const editorEl = document.querySelector('.task-page-editor .rich-editor-body');
      if (editorEl instanceof HTMLElement) editorEl.focus();
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

  const handleComplete = useCallback(() => {
    if (!taskId || !task) return;
    if (task.status === 'done') {
      updateTask.mutate({ id: taskId, status: 'active', completed_at: null } as Parameters<
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
    router.push('/');
  }, [taskId, updateTask, router]);

  const handleDelete = useCallback(() => {
    if (!taskId) return;
    deleteTask.mutate(taskId);
    router.push('/');
  }, [taskId, deleteTask, router]);

  useEffect(() => {
    return () => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
    };
  }, []);

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

  const goBack = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push('/');
  }, [router]);

  // Escape → back to main app (skips if another handler already consumed it)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        el.blur();
        return;
      }
      goBack();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [goBack]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground font-sans overflow-hidden">
      {/* Content + Chat */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto min-w-0">
          <div className="max-w-3xl mx-auto px-6">
            {/* Header */}
            <div className="flex items-center justify-between h-11 sticky top-0 z-10 bg-background/80 backdrop-blur-sm">
              <button
                onClick={goBack}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
                aria-label="Back"
              >
                <ChevronLeft size={16} />
                <span className="text-xs">Back</span>
              </button>

              <div className="flex items-center gap-2">
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
            {task ? (
              <div className="space-y-0">
                {/* Type label + area / parent breadcrumb */}
                <div className="pt-6">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold tracking-wide text-muted-foreground/60 uppercase">
                      {task.parent_id ? 'Subtask' : 'Task'}
                    </span>
                    <span className="text-muted-foreground/30">&middot;</span>
                    <AreaSelect
                      value={task.area_id}
                      onChange={(areaId) => saveField('area_id', areaId)}
                    />
                  </div>
                  {task.parent_id && parentTask && (
                    <button
                      onClick={() => router.push(`/task/${task.parent_id}`)}
                      className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors group"
                    >
                      <ChevronLeft size={12} className="opacity-60 group-hover:opacity-100" />
                      <span className="truncate max-w-[300px]">{parentTask.title}</span>
                    </button>
                  )}
                </div>

                <div className="pt-1">
                  <textarea
                    ref={titleRef}
                    className={cn(
                      'w-full text-3xl font-bold leading-tight bg-transparent border-none outline-none resize-none overflow-hidden text-foreground placeholder:text-muted-foreground/40',
                      isDone && 'line-through text-muted-foreground',
                    )}
                    placeholder="Task title"
                    defaultValue={task.title}
                    onInput={handleTitleInput}
                    onKeyDown={handleTitleKeyDown}
                    rows={1}
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                  />
                  <p className="text-[10px] text-muted-foreground/50 mt-1">
                    Created{' '}
                    {new Date(task.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                    {task.updated_at !== task.created_at && (
                      <>
                        {' '}
                        &middot; Edited{' '}
                        {new Date(task.updated_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </>
                    )}
                    {task.completed_at && (
                      <>
                        {' '}
                        &middot; Completed{' '}
                        {new Date(task.completed_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </>
                    )}
                  </p>
                </div>

                {/* Properties */}
                <div className="pt-4 pb-2">
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
                            setEditingDeadline(false);
                            const val = e.target.value;
                            saveField('hard_deadline', val ? new Date(val).toISOString() : null);
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
                            setEditingBoomerang(false);
                            const val = e.target.value;
                            saveField('resurface_after', val ? new Date(val).toISOString() : null);
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
                              saveField('blocked_on', null);
                              saveField('blocked_since', null);
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
                <SubtaskSection
                  parentId={task.id}
                  onOpenTask={(id) => router.push(`/task/${id}`)}
                />

                {/* Body editor */}
                <div className="pt-2 pb-16 task-page-editor">
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
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                Loading...
              </div>
            )}
          </div>
        </div>

        <SlideoutChat slideoutWidth={9999} contextLabel="this task" chat={chat} disabled={!task} />
      </div>
    </div>
  );
}
