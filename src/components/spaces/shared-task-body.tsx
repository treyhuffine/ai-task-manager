'use client';
import { teamDisplayName } from '@/lib/home/team-display-name';

import { SHARED_TASK_FIELDS } from '@/lib/spaces/shared-fields';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, Users } from 'lucide-react';
import type { TaskRecord } from '@/db/types';
import { useTask, useUpdateTask } from '@/hooks/use-tasks';
import { useDocumentAutosave } from '@/hooks/use-document-autosave';
import { spacePath } from '@/lib/spaces/document';
import { spaceAttachmentStore } from '@/lib/spaces/attachment-store';
import { sharedDraftKey } from '@/lib/team/shared-body';
import { entityKeys } from '@/lib/query/entity-keys';
import { patchEntityCaches } from '@/lib/query/optimistic-entity';
import { trpcClient } from '@/lib/trpc/client';

import { TaskDocument } from '@/components/tasks/task-document';
import { TaskPlanningProperties } from '@/components/tasks/task-planning-properties';
import { EntityLinkScope } from '@/components/editor/entity-link-scope';
import { RichEditor } from '@/components/editor/rich-editor';
import { AreaSelect } from '@/components/shared/area-select';

import { SubtaskSection } from '@/components/tasks/subtask-section';

import { TaskResults } from '@/components/results/task-results';
import { SaveStatus, SharedBodyState, useSharedBodyFor, type SharedBodyTarget } from '@/components/team/shared-body-editor';
import { TeamLabel } from './team-label';
import { useConnectedTeams } from './space-selector';
import { SharedPublishedResults } from './publish-result';

/**
 * A shared task in My Ri (docs/homes-spec.md §9.4, P7.3). The surface says who
 * it's shared with and keeps two parts apart:
 *
 * - The shared part, the team's: title, status, deadline and body. Edits go to
 *   the team as they're made, with the same revision checks, retained drafts
 *   and conflict choice as the team's own app.
 * - Only you: private notes, energy, effort, snooze and subtasks, and the
 *   person's own Area, distinct from the team's. None of it
 *   reaches the team.
 */
export function SharedTaskBody({ task, onOpenTask }: { task: TaskRecord; onOpenTask: (id: string) => void }) {
  const teams = useConnectedTeams();
  const connection = teams.data?.find((t) => t.id === task.sourceTeamId);
  const teamName = teamDisplayName(task.sourceTeamId!, teams.data);
  const updateTask = useUpdateTask();
  // Typed fields (the shared title, private notes) save as they're typed and
  // are kept as a draft until acknowledged, so switching spaces or closing
  // the window loses nothing. The base is the saved task, not this view.
  const { data: saved } = useTask(task.id);
  const autosave = useDocumentAutosave('tasks', task.id, saved, (input: Parameters<typeof updateTask.mutateAsync>[0]) => {
    if (SHARED_TASK_FIELDS.some(field => field in input)) return Promise.reject(Object.assign(new Error('This retained shared draft has no recorded team author. Its text is kept. Restore it from the original team sign-in.'), { status: 403 }));
    return updateTask.mutateAsync(input);
  });
  const sharedAutosave = useDocumentAutosave('tasks', task.id, saved, (input: Parameters<typeof updateTask.mutateAsync>[0]) => {
    if (!connection?.memberId || connection.status !== 'active') return Promise.reject(Object.assign(new Error('Reconnect the original team sign-in to save this draft.'), { status: 403 }));
    return updateTask.mutateAsync({ ...input, expectedSourceMemberId: connection.memberId });
  }, { homeId: task.sourceTeamId!, viewerId: connection?.memberId ?? 'disconnected' });
  const save = (patch: Parameters<typeof updateTask.mutate>[0] extends infer P ? Omit<P & object, 'id'> : never) =>
    updateTask.mutate({ id: task.id, ...patch } as Parameters<typeof updateTask.mutate>[0]);
  const source = task.source;
  const assignee = source?.assignee;
  const assignedToMe = !!source?.assigned;

  return <TaskDocument task={task}
    onTitleChange={title => sharedAutosave({ title })}
    onAreaChange={areaId => save({ areaId })}
    onDeadlineChange={hardDeadline => sharedAutosave({ hardDeadline })}
    areaControl={<TeamLabel teamId={task.sourceTeamId} sourceArea={source?.area} />}
    breadcrumb={<div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><Users size={12}/><span>Shared with {teamName}</span><span className="text-muted-foreground">{assignedToMe ? 'Assigned to you' : assignee ? `Assigned to ${assignee.name}` : 'Not assigned'}</span>{task.sourceTeamId && task.sourceTaskId && <a href={`${spacePath(task.sourceTeamId)}?task=${encodeURIComponent(task.sourceTaskId)}`} className="ml-auto underline">Open in {teamName}</a>}</div>}
    notice={<SourceNotice task={task} teamName={teamName} lastSyncedAt={connection?.lastSyncedAt ?? null} lastError={connection?.lastError ?? null} />}
    bodyContent={task.sourceState !== 'unavailable' && <SharedBody task={task} memberId={connection?.memberId ?? null} />}
    afterProperties={<section aria-label="Only you" className="mx-4 my-4 space-y-4 rounded-lg border border-dashed p-4 md:mx-12"><div><h3 className="flex items-center gap-1.5 text-xs font-semibold"><Lock size={12}/>Only you</h3><p className="text-xs text-muted-foreground">Your private planning for this task. {teamName} never sees it.</p></div><PrivateNotes task={task} onSave={userContext => autosave({ userContext })}/><div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-xs"><span className="font-medium text-muted-foreground">Area</span><AreaSelect value={task.areaId} onChange={areaId => save({ areaId })}/><TaskPlanningProperties task={task} save={save}/></div><SubtaskSection parentId={task.id} onOpenTask={onOpenTask}/></section>}
    footer={<div className="space-y-4 px-4 pb-10 md:px-12"><SharedPublishedResults task={task} teamName={teamName}/><TaskResults key={task.id} taskId={task.id}/></div>}
  />;
}

function SourceNotice({ task, teamName, lastSyncedAt, lastError }: { task: TaskRecord; teamName: string; lastSyncedAt: string | null; lastError: string | null }) {
  let text: string | null = null;
  if (task.sourceState === 'unavailable') text = `This task is no longer at ${teamName}. Your private planning is kept.`;
  else if (task.sourceState === 'released') text = `This is no longer assigned to you at ${teamName}. Your private planning is kept.`;
  else if (lastError) text = `${lastError}${lastSyncedAt ? ` Shown as of ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}`;
  if (!text) return null;
  return <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{text}</p>;
}

/** Text that follows the shared value while nobody is typing in it. */
function useFollowedDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [editing, setEditing] = useState(false);
  if (!editing && seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  return { draft, setDraft, setEditing };
}

function PrivateNotes({ task, onSave }: { task: TaskRecord; onSave: (value: string | null) => void }) {
  const { draft, setDraft, setEditing } = useFollowedDraft(task.userContext ?? '');
  return (
    <textarea
      aria-label="Private notes"
      value={draft}
      placeholder="Private notes, like what to try first."
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setDraft(e.target.value);
        onSave(e.target.value.trim() ? e.target.value : null);
      }}
      onBlur={() => setEditing(false)}
      className="min-h-[3.5rem] w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-primary/60 field-sizing-content"
    />
  );
}

/** The shared body: autosaved to the team against its revision, files stored at the team. */
function SharedBody({ task, memberId }: { task: TaskRecord; memberId: string | null }) {
  const teamId = task.sourceTeamId!;
  const sourceTaskId = task.sourceTaskId!;
  const qc = useQueryClient();
  const record = useMemo(
    () => ({ id: task.id, body: task.body, bodyRevision: task.source?.bodyRevision ?? 0 }),
    [task.id, task.body, task.source?.bodyRevision],
  );
  const target = useMemo<SharedBodyTarget | null>(() => {
    if (!memberId) return null;
    return {
      // The same draft as the team's own view of this task, for this person.
      draftKey: sharedDraftKey({ teamId, memberId }, 'task', sourceTaskId),
      toEditor: (body) => body,
      write: async ({ body, expectedBodyRevision, attachments }) => {
        const row = await trpcClient.tasks.update.mutate({
          id: task.id,
          patch: { body, ...(attachments.length > 0 ? { attachments } : {}) },
          expectedBodyRevision,
          expectedSourceMemberId: memberId ?? undefined,
        });
        const bodyRevision = row.source?.bodyRevision ?? expectedBodyRevision;
        // Only the revision goes into the cache, with the body the editor
        // sent: a server echo must never rewrite an open editor. Lists get
        // its excerpt.
        patchEntityCaches(qc, 'tasks', task.id, { body });
        qc.setQueryData(entityKeys.tasks.detail(task.id), (current: TaskRecord | undefined) =>
          current?.source ? { ...current, source: { ...current.source, bodyRevision } } : current,
        );
        return { body: row.body ?? body, bodyRevision };
      },
    };
  }, [task.id, teamId, sourceTaskId, memberId, qc]);
  const shared = useSharedBodyFor(record, target);
  const store = useMemo(() => spaceAttachmentStore(teamId), [teamId]);
  if (!shared.ready) return null;
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <SaveStatus status={shared.status} />
      </div>
      <SharedBodyState shared={shared} />
      <div className="task-slideout-editor shared-task-editor">
        <EntityLinkScope homeId={task.sourceTeamId!}><RichEditor
          key={shared.editorKey}
          content={shared.initial}
          onChange={shared.edit}
          onAttachment={shared.onAttachment}
          attachmentStore={store}
          applyExternalContent={shared.applyExternalContent}
          placeholder="The shared description. Your team sees what you write here."
          hideFooter
        /></EntityLinkScope>
      </div>
    </div>
  );
}
