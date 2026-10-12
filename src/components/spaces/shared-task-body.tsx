'use client';

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
import { trpcClient } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { RichEditor } from '@/components/editor/rich-editor';
import { AreaSelect } from '@/components/shared/area-select';
import { LifecycleStatusControl } from '@/components/tasks/lifecycle-status-control';
import { SubtaskSection } from '@/components/tasks/subtask-section';
import { EFFORT_OPTIONS, ENERGY_OPTIONS } from '@/components/tasks/task-options';
import { TaskResults } from '@/components/results/task-results';
import { SaveStatus, SharedBodyState, useSharedBodyFor, type SharedBodyTarget } from '@/components/team/shared-body-editor';
import { useConnectedTeams } from './space-selector';
import { SharedPublishedResults } from './publish-result';

/**
 * A shared task in My Ri (docs/homes-spec.md §9.4, P7.3). The surface says who
 * it's shared with and keeps two parts apart:
 *
 * - The shared part, the team's: title, status, deadline and body. Edits go to
 *   the team as they're made, with the same revision checks, retained drafts
 *   and conflict choice as the team's own app.
 * - Only you: private notes, energy, effort, snooze and subtasks, and Organize
 *   for me, the person's own Area, distinct from the team's. None of it
 *   reaches the team.
 */
export function SharedTaskBody({ task, onOpenTask }: { task: TaskRecord; onOpenTask: (id: string) => void }) {
  const teams = useConnectedTeams();
  const connection = teams.data?.find((t) => t.id === task.sourceTeamId);
  const teamName = connection?.name ?? 'the team';
  const updateTask = useUpdateTask();
  // Typed fields (the shared title, private notes) save as they're typed and
  // are kept as a draft until acknowledged, so switching spaces or closing
  // the window loses nothing. The base is the saved task, not this view.
  const { data: saved } = useTask(task.id);
  const autosave = useDocumentAutosave('tasks', task.id, saved, updateTask.mutateAsync);
  const save = (patch: Parameters<typeof updateTask.mutate>[0] extends infer P ? Omit<P & object, 'id'> : never) =>
    updateTask.mutate({ id: task.id, ...patch } as Parameters<typeof updateTask.mutate>[0]);
  const source = task.source;
  const assignee = source?.assignee;
  const assignedToMe = !!source?.assigned;

  return (
    <div className="space-y-6 px-4 pb-10 pt-4 md:px-12">
      <SourceNotice task={task} teamName={teamName} lastSyncedAt={connection?.lastSyncedAt ?? null} lastError={connection?.lastError ?? null} />

      {/* The shared part */}
      <section aria-label={`Shared with ${teamName}`} className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
            <Users size={12} /> Shared with {teamName}
          </span>
          {source?.area && <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">{source.area.name}</span>}
          <span className="text-muted-foreground">{assignedToMe ? 'Assigned to you' : assignee ? `Assigned to ${assignee.name}` : 'Not assigned'}</span>
          {task.sourceTeamId && task.sourceTaskId && (
            <a href={`${spacePath(task.sourceTeamId)}?task=${encodeURIComponent(task.sourceTaskId)}`} className="ml-auto text-muted-foreground underline-offset-2 hover:underline">
              Open in {teamName}
            </a>
          )}
        </div>
        <TitleField task={task} onSave={(title) => autosave({ title })} />
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-xs">
          <span className="font-medium text-muted-foreground">Status</span>
          <LifecycleStatusControl taskId={task.id} status={task.status} className="-ml-1.5" />
          <span className="font-medium text-muted-foreground">Deadline</span>
          <input
            type="date"
            aria-label="Deadline"
            value={task.hardDeadline?.slice(0, 10) ?? ''}
            onChange={(e) => save({ hardDeadline: e.target.value || null })}
            className="w-fit rounded-md border border-border bg-transparent px-2 py-1 text-xs"
          />
        </div>
        {task.sourceState !== 'unavailable' && <SharedBody task={task} memberId={connection?.memberId ?? null} />}
      </section>

      {/* Only you */}
      <section aria-label="Only you" className="space-y-4 rounded-lg border border-dashed border-border p-4">
        <div>
          <h3 className="flex items-center gap-1.5 text-[12px] font-semibold">
            <Lock size={12} /> Only you
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Your private planning for this task. {teamName} never sees it.</p>
        </div>
        <PrivateNotes task={task} onSave={(userContext) => autosave({ userContext })} />
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-xs">
          <span className="font-medium text-muted-foreground">Organize for me</span>
          <AreaSelect value={task.areaId ?? null} onChange={(areaId) => save({ areaId })} />
          <span className="font-medium text-muted-foreground">Energy</span>
          <div className="flex items-center gap-1">
            {ENERGY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => save({ energy: task.energy === opt.value ? null : opt.value })}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                  task.energy === opt.value ? `${opt.color} bg-current/10 ring-1 ring-current/20` : 'text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground',
                )}
              >
                <opt.icon size={10} />
                {opt.label}
              </button>
            ))}
          </div>
          <span className="font-medium text-muted-foreground">Effort</span>
          <div className="flex flex-wrap items-center gap-1">
            {EFFORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => save({ effort: task.effort === opt.value ? null : opt.value })}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                  task.effort === opt.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span className="font-medium text-muted-foreground">Snooze until</span>
          <input
            type="date"
            aria-label="Snooze until"
            value={task.resurfaceAfter?.slice(0, 10) ?? ''}
            onChange={(e) => save({ resurfaceAfter: e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null })}
            className="w-fit rounded-md border border-border bg-transparent px-2 py-1 text-xs"
          />
        </div>
        <SubtaskSection parentId={task.id} onOpenTask={onOpenTask} />
      </section>

      <SharedPublishedResults task={task} teamName={teamName} />

      {/* This person's own saved results: theirs until they publish one. */}
      <TaskResults key={task.id} taskId={task.id} />
    </div>
  );
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

function TitleField({ task, onSave }: { task: TaskRecord; onSave: (title: string) => void }) {
  const { draft, setDraft, setEditing } = useFollowedDraft(task.title);
  return (
    <textarea
      aria-label="Title"
      value={draft}
      rows={1}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setDraft(e.target.value);
        // A shared title is never empty: an emptied one waits for text.
        if (e.target.value.trim()) onSave(e.target.value);
      }}
      onBlur={() => {
        setEditing(false);
        if (!draft.trim()) setDraft(task.title);
      }}
      className="note-title w-full resize-none bg-transparent text-2xl font-semibold leading-tight outline-none field-sizing-content"
    />
  );
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
        });
        const bodyRevision = row.source?.bodyRevision ?? expectedBodyRevision;
        // Only the revision goes into the cache, with the body the editor
        // sent: a server echo must never rewrite an open editor.
        qc.setQueryData(entityKeys.tasks.detail(task.id), (current: TaskRecord | undefined) =>
          current?.source ? { ...current, body, source: { ...current.source, bodyRevision } } : current,
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
        <RichEditor
          key={shared.editorKey}
          content={shared.initial}
          onChange={shared.edit}
          onAttachment={shared.onAttachment}
          attachmentStore={store}
          applyExternalContent={shared.applyExternalContent}
          placeholder="The shared description. Your team sees what you write here."
          hideFooter
        />
      </div>
    </div>
  );
}
