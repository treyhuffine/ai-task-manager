'use client';

import { useState } from 'react';
import { Archive, History, MoreHorizontal, Trash2, Users } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDocumentAutosave } from '@/hooks/use-document-autosave';
import { useEntityVersions } from '@/hooks/use-entity-versions';
import { useDeleteNote, useNote, useUpdateNote } from '@/hooks/use-notes';
import { useDeleteTask, useTask, useUpdateTask } from '@/hooks/use-tasks';
import { trpcClient } from '@/lib/trpc/client';
import { entityKeys } from '@/lib/query/entity-keys';
import { NoteEditor } from '@/components/editor/rich-editor';
import { LifecycleStatusControl } from '@/components/tasks/lifecycle-status-control';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Tip } from '@/components/ui/tip';
import type { EntityVersionRecord } from '@/db/types';
import { useTeam, useTeamNav } from './team-context';
import { useTeamMembers } from './use-team';
import { MemberAvatar } from './member-avatar';
import { SaveStatus, SharedBodyState, useSharedBody } from './shared-body-editor';
import { TeamAreaSelect } from './team-areas';

/** A shared task or note, open beside the board or list. */
export function TeamDetail() {
  const nav = useTeamNav();
  const open = !!(nav.taskId || nav.noteId);
  return (
    <Sheet open={open} onOpenChange={(next) => !next && nav.closeDetail()}>
      <SheetContent side="right" showCloseButton className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-2xl">
        <SheetTitle className="sr-only">{nav.taskId ? 'Task' : 'Note'}</SheetTitle>
        {nav.taskId ? <TeamTaskPanel id={nav.taskId} /> : nav.noteId ? <TeamNotePanel id={nav.noteId} /> : null}
      </SheetContent>
    </Sheet>
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
  const { member } = useTeam();
  const nav = useTeamNav();
  const { data: task } = useTask(id);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const confirm = useConfirm();
  const { active } = useTeamMembers();
  // Title and the other shared fields save as they always have. The body
  // saves against its revision (useSharedBody).
  const autosave = useDocumentAutosave('tasks', id, task, updateTask.mutateAsync);
  const shared = useSharedBody('task', task ? { id: task.id, body: task.body ?? null, bodyRevision: task.bodyRevision } : undefined);
  if (!task) return <PanelLoading />;
  const assignee = active.find((m) => m.id === task.assigneeMemberId) ?? null;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3 pr-12">
        <LifecycleStatusControl taskId={task.id} status={task.status} />
        <Audience />
        <div className="flex-1" />
        <SaveStatus status={shared.status} />
        <HistoryButton kind="task" id={task.id} bodyRevision={task.bodyRevision} />
        <MoreMenu
          canDelete={member.role === 'owner'}
          onArchive={() => void trpcClient.tasks.transition.mutate({ id: task.id, command: 'archive' }).then(() => toast.success('Archived'))}
          onDelete={async () => {
            if (await confirm({ title: 'Delete this task for everyone?', description: 'It leaves the team for good. Archive keeps it findable.', confirmLabel: 'Delete', tone: 'destructive' })) {
              await deleteTask.mutateAsync(task.id);
              nav.closeDetail();
            }
          }}
        />
      </div>
      <div className="flex-1 px-5 py-5">
        {shared.ready && (
          <NoteEditor
            key={shared.editorKey}
            title={task.title?.trim() ? task.title : ''}
            body={shared.initial}
            onTitleChange={(title) => autosave({ title: title || ' ' })}
            onBodyChange={shared.edit}
            applyExternalContent={shared.applyExternalContent}
            onAttachment={shared.onAttachment}
            hideFooter
            metadata={
              <div className="mb-4 space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  <Field label="Assigned to">
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
                  </Field>
                  <Field label="Area">
                    <TeamAreaSelect value={task.areaId ?? null} onChange={(areaId) => updateTask.mutate({ id: task.id, areaId })} />
                  </Field>
                  <Field label="Due">
                    <input
                      type="date"
                      value={task.hardDeadline?.slice(0, 10) ?? ''}
                      onChange={(e) => updateTask.mutate({ id: task.id, hardDeadline: e.target.value || null })}
                      className="rounded-md bg-transparent px-1.5 py-1 text-xs text-foreground hover:bg-muted/50 [color-scheme:dark]"
                      aria-label="Due date"
                    />
                  </Field>
                </div>
                <SharedBodyState shared={shared} />
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

function TeamNotePanel({ id }: { id: string }) {
  const { member } = useTeam();
  const nav = useTeamNav();
  const { data: note } = useNote(id);
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const confirm = useConfirm();
  const autosave = useDocumentAutosave('notes', id, note, updateNote.mutateAsync);
  const shared = useSharedBody('note', note ? { id: note.id, body: note.body, bodyRevision: note.bodyRevision } : undefined);
  if (!note) return <PanelLoading />;
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3 pr-12">
        <Audience />
        <div className="flex-1" />
        <SaveStatus status={shared.status} />
        <HistoryButton kind="note" id={note.id} bodyRevision={note.bodyRevision} />
        <MoreMenu
          canDelete={member.role === 'owner'}
          onArchive={() => {
            updateNote.mutate({ id: note.id, status: 'archived' });
            nav.closeDetail();
            toast.success('Archived');
          }}
          onDelete={async () => {
            if (await confirm({ title: 'Delete this note for everyone?', description: 'It leaves the team for good. Archive keeps it findable.', confirmLabel: 'Delete', tone: 'destructive' })) {
              await deleteNote.mutateAsync(note.id);
              nav.closeDetail();
            }
          }}
        />
      </div>
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
                  <Field label="Area">
                    <TeamAreaSelect value={note.areaId ?? null} onChange={(areaId) => updateNote.mutate({ id: note.id, areaId })} />
                  </Field>
                </div>
                <SharedBodyState shared={shared} />
              </div>
            }
          />
        )}
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

function MoreMenu({ canDelete, onArchive, onDelete }: { canDelete: boolean; onArchive: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="More" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground">
        <MoreHorizontal size={15} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 text-xs">
        <DropdownMenuItem onSelect={onArchive}>
          <Archive size={13} /> Archive
        </DropdownMenuItem>
        {canDelete && (
          <DropdownMenuItem onSelect={onDelete} className="text-red-600 dark:text-red-400">
            <Trash2 size={13} /> Delete for everyone
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Who did what to this, as the team sees it: "Maya changed this". */
function describe(version: EntityVersionRecord, name: (id: string | null) => string): string {
  const who = name(version.actorMemberId ?? null);
  const by = version.source === 'ai' ? `${who}'s agent` : who;
  if (version.summary === 'Created') return `${by} added this`;
  if (version.revertedFromVersionId) return `${by} restored an earlier version`;
  return `${by} changed this`;
}

function HistoryButton({ kind, id, bodyRevision }: { kind: 'task' | 'note'; id: string; bodyRevision: number }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { byId } = useTeamMembers();
  const versions = useEntityVersions(kind, id, open);
  const name = (memberId: string | null) => (memberId ? (byId.get(memberId)?.name ?? 'Someone') : 'Someone');
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tip label="History">
        <DropdownMenuTrigger aria-label="History" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground">
          <History size={15} />
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto text-xs">
        {(versions.data?.versions ?? []).length === 0 && <p className="px-2 py-3 text-muted-foreground">No changes yet.</p>}
        {(versions.data?.versions ?? []).map((version, index) => (
          <DropdownMenuItem
            key={version.id}
            disabled={index === 0}
            onSelect={async () => {
              const expectedBodyRevision = bodyRevision;
              if (!(await confirm({ title: 'Restore this version?', description: 'Everyone sees the restored text. This change goes into the history too, so it can be undone.', confirmLabel: 'Restore' }))) return;
              try {
                await trpcClient.entityVersions.revertPost.mutate({ params: { id: version.id }, body: { expectedBodyRevision } });
              } catch {
                toast.error('Could not restore. The shared text may have changed. Refresh and review it before trying again.');
                return;
              }
              void qc.invalidateQueries({ queryKey: kind === 'task' ? entityKeys.tasks.all : entityKeys.notes.all });
              void qc.invalidateQueries({ queryKey: ['entity-versions', kind, id] });
              toast.success('Restored');
            }}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="flex items-center gap-1.5">
              <MemberAvatar name={name(version.actorMemberId ?? null)} size="xs" />
              {describe(version, name)}
            </span>
            <span className="pl-5 text-[10px] text-muted-foreground">
              {new Date(version.createdAt).toLocaleString()}
              {index === 0 ? ' · current' : ' · restore'}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
