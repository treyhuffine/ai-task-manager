'use client';
import { EntityDetailHeader, EntityActionsMenu } from '@/components/entities/entity-detail-header';

import { useDocumentAutosave, usePendingDocument } from '@/hooks/use-document-autosave';

import { useEffect, useCallback, useRef, useState } from 'react';
import { EntitySheet } from '@/components/entities/entity-sheet';
import { X, Check, Pencil, ChevronLeft, Maximize2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTask, useUpdateTask, useDeleteTask } from '@/hooks/use-tasks';
import { useTaskLifecycle } from '@/hooks/use-task-lifecycle';
import { StartWithAgentButton } from '@/components/tasks/start-with-agent-button';
import { useDashboard } from '@/contexts/dashboard-context';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';

import { PersonalTaskDocument } from './personal-task-document';




import { SharedTaskBody } from '@/components/spaces/shared-task-body';
import { removeFromMyWork } from '@/components/spaces/my-work';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { SlideoutChat, useDocumentChat } from '@/components/ai-elements/slideout-chat';
import { useDragResize } from '@/hooks/use-drag-resize';
import { ReferencingSessionsButton } from '@/components/shared/referencing-sessions-button';
import { EntityHistoryButton } from '@/components/chat-ui/edits/entity-history-button';
import { EntityChangeBanner } from '@/components/chat-ui/edits/entity-change-banner';
import { EntityViewToggle } from '@/components/entities/entity-view-toggle';
import { ENTITY_HEADER_LABEL } from '@/components/entities/entity-header';
import { EntityAgentView } from '@/components/entities/entity-agent-view';
import { useEntityViewMode, resolveEntityView, type EntityViewMode } from '@/lib/client/entity-view-mode';
import { cn } from '@/lib/utils';

import type { Attachment } from '@/db/types';

const DEFAULT_WIDTH = 1200;
const MIN_WIDTH = 420;
const MAX_WIDTH = 1400;


interface TaskSlideoutProps {
  taskId: string | null;
  onClose: () => void;
  onCloseAll: () => void;
  hasHistory: boolean;
}

export function TaskSlideout({ taskId, onClose, onCloseAll, hasHistory }: TaskSlideoutProps) {
  const isOpen = taskId !== null;
  const { data: savedTask } = useTask(taskId);
  const task = usePendingDocument('tasks', taskId, savedTask);
  const { data: parentTask } = useTask(task?.parentId ?? null);
  const { openTask } = useDashboard();
  const router = useRouter();
  const updateTask = useUpdateTask();
  const autosave = useDocumentAutosave('tasks', taskId, savedTask, updateTask.mutateAsync);
  const deleteTask = useDeleteTask();
  const lifecycle = useTaskLifecycle();
  const chat = useDocumentChat('task', task ?? null);
  const aiBusy = chat.status === 'streaming' || chat.status === 'submitted';

  // Agent-first trial (Settings > General > Notes and tasks). Per open: the
  // pref decides the starting view, the header toggle flips it for this task.
  const { agentFirst } = useEntityViewMode();
  const [viewOverride, setViewOverride] = useState<{ id: string; view: EntityViewMode } | null>(null);
  // A shared task (docs/homes-spec.md §9.4) has its own body: the team's
  // part and Only you. Its document chat stays off: its agent would be
  // writing the team's text.
  const shared = !!task?.sourceTeamId;
  const view = shared ? 'editor' : resolveEntityView(agentFirst, viewOverride, taskId);
  const setView = useCallback(
    (next: EntityViewMode) => { if (taskId) setViewOverride({ id: taskId, view: next }); },
    [taskId],
  );

  const { size: width, isResizing, handleResizeStart } = useDragResize({
    edge: 'left',
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    defaultSize: DEFAULT_WIDTH,
    storageKey: 'ri.task-slideout.width',
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingAttachmentsRef = useRef<Attachment[]>([]);

  const handleAttachment = useCallback((attachment: Attachment) => {
    pendingAttachmentsRef.current = [...pendingAttachmentsRef.current, attachment];
  }, []);




  const handleBodyChange = useCallback(
    (markdown: string) => {
      if (!taskId) return;

      const attachments = pendingAttachmentsRef.current;
      autosave({
        body: markdown || null,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
    },
    [taskId, autosave],
  );

  const handleFoldedHeadingsChange = useCallback(
    (folded: string[]) => {
      if (!taskId) return;

      autosave({ foldedHeadings: folded });
    },
    [taskId, autosave],
  );

  // Open-children and running-workstream confirmations are enforced server-side
  // and surfaced by the lifecycle hooks' guard modals, so every surface behaves
  // the same — no per-surface pre-check here.
  const handleComplete = useCallback(() => {
    if (!taskId || !task) return;
    lifecycle.toggle(taskId, task.status);
  }, [taskId, task, lifecycle]);

  const handleArchive = useCallback(() => {
    if (!taskId || !task) return;
    lifecycle.archive(taskId);
    onClose();
  }, [taskId, task, lifecycle, onClose]);

  const handleDelete = useCallback(() => {
    if (!taskId) return;
    deleteTask.mutate(taskId);
    onClose();
  }, [taskId, deleteTask, onClose]);

  // Cleanup

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
  // A brand-new task is seeded with a blank/whitespace title and no body. Render
  // its title field empty so the "Task title" placeholder shows on the first
  // paint, rather than briefly painting the seeded space before the effect above
  // clears it.
  const isNewTask = !!task && !task.title?.trim() && !task.body;



  return (
    <EntitySheet open={isOpen} label="Task" width={width} contentRef={containerRef} resizing={isResizing} onClose={onClose} onCloseAll={onCloseAll} showCloseButton={false} onOpenAutoFocus={(event) => { event.preventDefault(); if (isNewTask) containerRef.current?.querySelector<HTMLElement>('[data-entity-title]')?.focus(); }}>

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

              <div className="flex min-w-0 items-center gap-2">
                {agentFirst && !shared && <EntityViewToggle value={view} onChange={setView} compact={width < 700} />}
                {taskId && !shared && <EntityHistoryButton entityType="task" entityId={taskId} />}
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

                {task && task.status !== 'done' && task.status !== 'archived' && (
                  <StartWithAgentButton task={task} />
                )}
                {/* Complete/Reopen only where it is the real action (not for
                    Consider or Archived — change those with the status control). */}
                {task && task.status !== 'consider' && task.status !== 'archived' && (
                  <button
                    onClick={handleComplete}
                    aria-label={isDone ? 'Completed' : 'Complete'}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                      isDone
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'border border-border text-muted-foreground hover:text-foreground hover:bg-accent',
                    )}
                  >
                    <Check size={12} />
                    <span className={ENTITY_HEADER_LABEL}>{isDone ? 'Completed' : 'Complete'}</span>
                  </button>
                )}

                <EntityActionsMenu onArchive={handleArchive} onDelete={shared ? undefined : handleDelete} archiveLabel={shared ? 'Archive for the team' : 'Archive'}>
                    {shared && task?.source?.addedAt && task.sourceTeamId && task.sourceTaskId && <DropdownMenuItem onSelect={() => void removeFromMyWork(task.sourceTeamId!, task.sourceTaskId!).then(onClose)}><X size={12} /> Remove from my work</DropdownMenuItem>}
                  </EntityActionsMenu>
              </div>
            </EntityDetailHeader>

            {/* Body + Chat */}
            {view === 'agent' && task ? (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
                <EntityAgentView
                  entityType="task"
                  entityId={task.id}
                  chat={chat}
                  onOpenDocument={() => setView('editor')}
                  onOpenTask={openTask}
                />
              </div>
            ) : (
            <div className="flex-1 flex overflow-hidden relative">
              {/* Main content */}
              <div className="flex-1 overflow-y-auto min-w-0 relative">
                {task && shared ? (
                  <SharedTaskBody task={task} onOpenTask={openTask} />
                ) : task ? (
                  <div className="space-y-0">
                    <EntityChangeBanner entityType="task" entityId={task.id} />
                    <PersonalTaskDocument task={task} parentTask={parentTask} openTask={openTask}
                      save={patch => updateTask.mutate({ id: task.id, ...patch })} autosave={autosave}
                      bodyEditor={{ content: task.body ?? '', onChange: handleBodyChange, onAttachment: handleAttachment, editable: !aiBusy, placeholder: "Type '/' for commands, @ to link a task or note...", hideFooter: true, foldedHeadings: task.foldedHeadings ?? [], onFoldedHeadingsChange: handleFoldedHeadingsChange }} />
                  </div>
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
              {!shared && <SlideoutChat
                slideoutWidth={width}
                collapseThreshold={740}
                contextLabel="this task"
                chat={chat}
                disabled={!task}
              />}
            </div>
            )}
          </div>
    </EntitySheet>
  );
}
