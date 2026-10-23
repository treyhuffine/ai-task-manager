'use client';
import { EntityDetailHeader, EntityActionsMenu } from '@/components/entities/entity-detail-header';
import { EntityPageBoundary } from '@/components/home/entity-page-boundary';
import { HomeBoundary } from '@/components/home/home-context';
import { useDocumentAutosave, usePendingDocument } from '@/hooks/use-document-autosave';

import { use, useEffect, useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Check, X } from 'lucide-react';
import { useTask, useUpdateTask, useDeleteTask } from '@/hooks/use-tasks';
import { useTaskLifecycle } from '@/hooks/use-task-lifecycle';

import { StartWithAgentButton } from '@/components/tasks/start-with-agent-button';
import { SlideoutChat, useDocumentChat } from '@/components/ai-elements/slideout-chat';
import { EntityHistoryButton } from '@/components/chat-ui/edits/entity-history-button';
import { EntityChangeBanner } from '@/components/chat-ui/edits/entity-change-banner';
import { EntityViewToggle } from '@/components/entities/entity-view-toggle';
import { ENTITY_HEADER_LABEL } from '@/components/entities/entity-header';
import { EntityAgentView } from '@/components/entities/entity-agent-view';
import { useEntityViewMode, resolveEntityView, type EntityViewMode } from '@/lib/client/entity-view-mode';
import { PersonalTaskDocument } from '@/components/tasks/personal-task-document';



import { SharedTaskBody } from '@/components/spaces/shared-task-body';
import { removeFromMyWork } from '@/components/spaces/my-work';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Attachment } from '@/db/types';

function TaskPageContent({ params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = use(params);
  const router = useRouter();
  const { data: savedTask } = useTask(taskId);
  const task = usePendingDocument('tasks', taskId, savedTask);
  const { data: parentTask } = useTask(task?.parentId ?? null);
  const updateTask = useUpdateTask();
  const autosave = useDocumentAutosave('tasks', taskId, savedTask, updateTask.mutateAsync);
  const deleteTask = useDeleteTask();
  const lifecycle = useTaskLifecycle();
  const chat = useDocumentChat('task', task ?? null);
  const aiBusy = chat.status === 'streaming' || chat.status === 'submitted';

  // Agent-first trial (Settings > General > Notes and tasks). Resolved after
  // mount so the server render never disagrees with localStorage.
  const { agentFirst } = useEntityViewMode();
  const [viewOverride, setViewOverride] = useState<{ id: string; view: EntityViewMode } | null>(null);
  // A shared task (docs/homes-spec.md §9.4) has its own body, the team's
  // part and Only you, and no document chat writing the team's text.
  const shared = !!task?.sourceTeamId;
  const view = shared ? 'editor' : resolveEntityView(agentFirst, viewOverride, taskId);
  const setView = useCallback((next: EntityViewMode) => setViewOverride({ id: taskId, view: next }), [taskId]);

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
  // and surfaced by the lifecycle hooks' guard modals, uniformly across surfaces.
  const handleComplete = useCallback(() => {
    if (!taskId || !task) return;
    lifecycle.toggle(taskId, task.status);
  }, [taskId, task, lifecycle]);

  const handleArchive = useCallback(() => {
    if (!taskId || !task) return;
    lifecycle.archive(taskId);
    router.push('/');
  }, [taskId, task, lifecycle, router]);

  const handleDelete = useCallback(() => {
    if (!taskId) return;
    deleteTask.mutate(taskId);
    router.push('/');
  }, [taskId, deleteTask, router]);


  const isDone = task?.status === 'done';



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

  const header = (
        <EntityDetailHeader className="h-11 sticky top-0 z-10 bg-background/80 px-0 py-0 backdrop-blur-sm">
          <button
            onClick={goBack}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5 shrink-0"
            aria-label="Back"
          >
            <ChevronLeft size={16} />
            <span className="text-xs">Back</span>
          </button>

          <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar [&>*]:shrink-0">
            {agentFirst && !shared && <EntityViewToggle value={view} onChange={setView} />}
            {task && !shared && <EntityHistoryButton entityType="task" entityId={task.id} />}
            {task && task.status !== 'done' && task.status !== 'archived' && (
              <StartWithAgentButton task={task} />
            )}
            {/* Complete/Reopen only where it is the real action. Consider is
                not committed work and Archived is history — change those with
                the status control, so no button mislabels a no-op or a
                restore as "Complete". */}
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

            <EntityActionsMenu onArchive={handleArchive} archiveLabel={shared ? 'Archive for the team' : 'Archive'} onDelete={shared ? undefined : handleDelete}>
              {shared && task?.source?.addedAt && task.sourceTeamId && task.sourceTaskId && (
                <DropdownMenuItem onSelect={() => void removeFromMyWork(task.sourceTeamId!, task.sourceTaskId!).then(() => router.push('/'))}>
                  <X size={12} /> Remove from my work
                </DropdownMenuItem>
              )}
            </EntityActionsMenu>
          </div>
        </EntityDetailHeader>
  );

  return (
    <div className="h-screen flex flex-col bg-background text-foreground font-sans overflow-hidden">
      {/* Content + Chat */}
      <div className="flex-1 flex overflow-hidden">
        {view === 'agent' && task ? (
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="max-w-3xl mx-auto w-full px-6 flex-shrink-0">{header}</div>
            <EntityAgentView
              entityType="task"
              entityId={task.id}
              chat={chat}
              onOpenDocument={() => setView('editor')}
              onOpenTask={(id) => router.push(`/task/${id}`)}
            />
          </div>
        ) : (
        <>
        <div className="flex-1 overflow-y-auto min-w-0">
          <div className="max-w-3xl mx-auto px-6">
            {header}
            {task && shared ? (
              <div className="-mx-4 md:-mx-12">
                <SharedTaskBody task={task} onOpenTask={(id) => router.push(`/task/${id}`)} />
              </div>
            ) : task ? (
              <div className="space-y-0">
                <EntityChangeBanner entityType="task" entityId={task.id} />
                    <PersonalTaskDocument task={task} parentTask={parentTask} openTask={id => router.push(`/task/${id}`)}
                      save={patch => updateTask.mutate({ id: task.id, ...patch })} autosave={autosave}
                      bodyEditor={{ content: task.body ?? '', onChange: handleBodyChange, onAttachment: handleAttachment, editable: !aiBusy, placeholder: "Type '/' for commands, @ to link a task or note...", hideFooter: true, foldedHeadings: task.foldedHeadings ?? [], onFoldedHeadingsChange: handleFoldedHeadingsChange }} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                Loading...
              </div>
            )}
          </div>
        </div>

        {!shared && <SlideoutChat slideoutWidth={9999} contextLabel="this task" chat={chat} disabled={!task} />}
        </>
        )}
      </div>
    </div>
  );
}

export default function TaskPage(props: Parameters<typeof TaskPageContent>[0]) {
  const { id } = use(props.params);
  return <HomeBoundary><EntityPageBoundary kind="task" id={id}><TaskPageContent {...props} /></EntityPageBoundary></HomeBoundary>;
}
