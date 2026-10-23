'use client';

import { EntityDetailHeader, EntityActionsMenu } from '@/components/entities/entity-detail-header';
import { LinkedReferences } from '@/components/shared/linked-references';
import { ReferencingSessionsButton } from '@/components/shared/referencing-sessions-button';
import { useHomeContext } from '@/components/home/home-context';

import { Users } from 'lucide-react';
import { toast } from 'sonner';
import { useDocumentAutosave } from '@/hooks/use-document-autosave';
import { useDeleteNote, useNote, useUpdateNote } from '@/hooks/use-notes';
import { useDeleteTask, useTask, useUpdateTask } from '@/hooks/use-tasks';
import { useTaskLifecycle } from '@/hooks/use-task-lifecycle';
import { TaskDocument } from '@/components/tasks/task-document';
import { NoteEditor } from '@/components/editor/rich-editor';
import { LifecycleStatusControl } from '@/components/tasks/lifecycle-status-control';
import { EntitySheet } from '@/components/entities/entity-sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { EntityVersionRecord } from '@/db/types';
import { useTeam, useTeamNav } from './team-context';
import { useTeamMembers } from './use-team';
import { MemberAvatar } from './member-avatar';
import { SaveStatus, SharedBodyState, useSharedBody } from './shared-body-editor';
import { TeamAreaSelect } from './team-areas';
import { MyWorkControl, SaveNoteControl } from '@/components/spaces/my-work-control';
import { TeamPublishedResults } from '@/components/spaces/published-results';
import { DecisionLabel, NoteKindMenuItem } from '@/components/notes/note-kind';
import { EntityHistoryButton } from '@/components/chat-ui/edits/entity-history-button';
import { TeamTaskAgentAction } from './team-task-agent-action';

/** A shared task or note, open beside the board or list. */
export function TeamRecordControls() {
  const nav = useTeamNav();
  const open = !!(nav.taskId || nav.noteId);
  return (
    <EntitySheet open={open} label={nav.taskId ? 'Task' : 'Note'} onClose={nav.closeDetail}>
      {nav.taskId ? <TeamTaskPanel id={nav.taskId} /> : nav.noteId ? <TeamNotePanel id={nav.noteId} /> : null}
    </EntitySheet>
  );
}

/** Who sees this: the whole team, said plainly where it's edited (§9.4). */
function Audience() {
  const { team } = useTeam();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Users size={11} aria-hidden /> Shared with {team.name}
    </span>
  );
}

function TeamTaskPanel({ id }: { id: string }) {
  const homeCapabilities = useHomeContext().capabilities;
  const { member } = useTeam();
  const nav = useTeamNav();
  const { data: task } = useTask(id);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const lifecycle = useTaskLifecycle();
  const confirm = useConfirm();
  const { active } = useTeamMembers();
  // Title and the other shared fields save as they always have. The body
  // saves against its revision (useSharedBody).
  const autosave = useDocumentAutosave('tasks', id, task, updateTask.mutateAsync);
  const shared = useSharedBody('task', task ? { id: task.id, body: task.body ?? null, bodyRevision: task.bodyRevision } : undefined);
  if (!task) return <PanelLoading />;
  const assignee = active.find((m) => m.id === task.assigneeMemberId) ?? null;

  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <EntityDetailHeader className="pr-12">
        <LifecycleStatusControl taskId={task.id} status={task.status} />
        <Audience />
        <div className="flex-1" />
        <SaveStatus status={shared.status} />
        <MyWorkControl taskId={task.id} />
        <TeamTaskAgentAction task={task} />
        <ReferencingSessionsButton entityType="task" entityId={task.id} />
        <HistoryButton kind="task" id={task.id} bodyRevision={task.bodyRevision} />
        <EntityActionsMenu
          deleteLabel="Delete for everyone"
          onArchive={() => lifecycle.archive(task.id)}
          onDelete={homeCapabilities.deletePermanently ? async () => {
            if (await confirm({ title: 'Delete this task for everyone?', description: 'It leaves the team for good. Archive keeps it findable.', confirmLabel: 'Delete', tone: 'destructive' })) {
              await deleteTask.mutateAsync(task.id);
              nav.closeDetail();
            }
          } : undefined}
        />
      </EntityDetailHeader>
      <div className="min-w-0 flex-1 py-5">
        {shared.ready && (
          <TaskDocument task={task}
            onTitleChange={(title) => autosave({ title })}
            onAreaChange={(areaId) => updateTask.mutate({ id: task.id, areaId })}
            onDeadlineChange={(hardDeadline) => updateTask.mutate({ id: task.id, hardDeadline })}
            areaControl={<TeamAreaSelect value={task.areaId} onChange={(areaId) => updateTask.mutate({ id: task.id, areaId })} />}
            bodyKey={shared.editorKey}
            bodyEditor={{ content: shared.initial, onChange: shared.edit, applyExternalContent: shared.applyExternalContent, onAttachment: shared.onAttachment, hideFooter: true }}
            notice={<SharedBodyState shared={shared} />}
            properties={<><span className="font-medium text-muted-foreground">Assigned to</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted/50">
                        {assignee ? <MemberAvatar name={assignee.name} size="xs" /> : null}
                        <span className={assignee ? 'text-foreground' : 'text-muted-foreground'}>{assignee ? assignee.name : 'Nobody'}</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48">
                        <DropdownMenuRadioGroup
                          value={task.assigneeMemberId ?? ''}
                          onValueChange={(value) => updateTask.mutate({ id: task.id, assigneeMemberId: value || null })}
                        >
                          <DropdownMenuRadioItem value="" className="text-xs">Nobody</DropdownMenuRadioItem>
                          {active.map((m) => (
                            <DropdownMenuRadioItem key={m.id} value={m.id} className="text-xs">
                              {m.name}
                              {m.id === member.id ? ' (you)' : ''}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
            </>}
          />
        )}
        <div className="mt-6 px-4 md:px-12">
          <TeamPublishedResults taskId={task.id} /><LinkedReferences entityType="task" entityId={task.id} />
        </div>
      </div>
    </div>
  );
}

function TeamNotePanel({ id }: { id: string }) {
  const homeCapabilities = useHomeContext().capabilities;
  const nav = useTeamNav();
  const { data: note } = useNote(id);
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const confirm = useConfirm();
  const autosave = useDocumentAutosave('notes', id, note, updateNote.mutateAsync);
  const shared = useSharedBody('note', note ? { id: note.id, body: note.body, bodyRevision: note.bodyRevision } : undefined);
  if (!note) return <PanelLoading />;
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <EntityDetailHeader className="pr-12">
        <Audience />
        <div className="flex-1" />
        <SaveStatus status={shared.status} />
        <SaveNoteControl noteId={note.id} />
        <ReferencingSessionsButton entityType="note" entityId={note.id} />
        <HistoryButton kind="note" id={note.id} bodyRevision={note.bodyRevision} />
        <EntityActionsMenu
          deleteLabel="Delete for everyone"

          onArchive={() => {
            updateNote.mutate({ id: note.id, status: 'archived' });
            nav.closeDetail();
            toast.success('Archived');
          }}
          onDelete={homeCapabilities.deletePermanently ? async () => {
            if (await confirm({ title: 'Delete this note for everyone?', description: 'It leaves the team for good. Archive keeps it findable.', confirmLabel: 'Delete', tone: 'destructive' })) {
              await deleteNote.mutateAsync(note.id);
              nav.closeDetail();
            }
          } : undefined}
        ><NoteKindMenuItem kind={note.kind} onChange={kind => updateNote.mutate({ id: note.id, kind })} /></EntityActionsMenu>
      </EntityDetailHeader>
      <div className="flex-1 px-5 py-5">
        {shared.ready && (
          <NoteEditor
            key={shared.editorKey}
            title={note.title ?? ''}
            body={shared.initial}
            onTitleChange={(title) => autosave({ title: title || null })}
            onBodyChange={shared.edit}
            applyExternalContent={shared.applyExternalContent}
            onAttachment={shared.onAttachment}
            hideFooter
            metadata={
              <div className="mb-4 space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  <DecisionLabel kind={note.kind} />
                  <Field label="Area">
                    <TeamAreaSelect value={note.areaId ?? null} onChange={(areaId) => updateNote.mutate({ id: note.id, areaId })} />
                  </Field>
                </div>
                <SharedBodyState shared={shared} />
              </div>
            }
          />
        )}
        <LinkedReferences entityType="note" entityId={note.id} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-muted-foreground/80">{label}</span>
      {children}
    </span>
  );
}

function PanelLoading() {
  return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
}

/**
 * Who did what to this, as the team sees it: "Maya changed this", "Maya's
 * agent changed this", or "Team AI, for Maya, changed this" (§9.8, §9.9).
 */
function describe(version: EntityVersionRecord, name: (id: string | null) => string): string {
  const who = name(version.actorMemberId ?? null);
  const by = version.source !== 'ai' ? who : version.actorSessionId ? `Team AI, for ${who},` : `${who}'s agent`;
  if (version.summary === 'Created') return `${by} added this`;
  if (version.revertedFromVersionId) return `${by} restored an earlier version`;
  return `${by} changed this`;
}

function HistoryButton({ kind, id, bodyRevision }: { kind: 'task' | 'note'; id: string; bodyRevision: number }) {
  const { byId } = useTeamMembers();
  const confirm = useConfirm();
  const name = (memberId: string | null) => memberId ? byId.get(memberId)?.name ?? 'Former member' : 'Someone';
  return <EntityHistoryButton entityType={kind} entityId={id} expectedBodyRevision={bodyRevision}
    describeActor={(version) => describe(version, name)}
    confirmRevert={() => confirm({ title: 'Restore this version?', description: 'Everyone sees the restored text. The change stays in history.', confirmLabel: 'Restore' })}
  />;
}
