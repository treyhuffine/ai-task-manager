'use client';

import { Lock, PencilLine, Users } from 'lucide-react';
import type { NoteRecord } from '@/db/types';
import { useUpdateNote } from '@/hooks/use-notes';
import { spacePath } from '@/lib/spaces/document';
import { RichEditor } from '@/components/editor/rich-editor';
import { AreaSelect } from '@/components/shared/area-select';
import { LinkedReferences } from '@/components/shared/linked-references';
import { useConnectedTeams } from './space-selector';
import { spaceAttachmentStore } from '@/lib/spaces/attachment-store';

/** Where a saved team note is edited: its team's own space, opened on it. */
export function teamNoteHref(note: Pick<NoteRecord, 'sourceTeamId' | 'sourceNoteId'>): string | null {
  if (!note.sourceTeamId || !note.sourceNoteId) return null;
  return `${spacePath(note.sourceTeamId)}?note=${encodeURIComponent(note.sourceNoteId)}`;
}

/**
 * A team note saved in My Ri (docs/homes-spec.md §9.3, P7.4): a reference
 * beside personal notes, not a second editable copy. The team's title and
 * text show as the team last said, with where to edit them. How it's
 * organized here is the person's own and never reaches the team.
 */
export function SharedNoteBody({ note }: { note: NoteRecord }) {
  const teams = useConnectedTeams();
  const teamName = teams.data?.find((t) => t.id === note.sourceTeamId)?.name ?? 'the team';
  const updateNote = useUpdateNote();
  const href = teamNoteHref(note);
  const gone = note.sourceState === 'unavailable';
  const syncedAt = note.source?.syncedAt;

  return (
    <div className="space-y-6 px-4 pb-10 pt-2 md:px-12">
      {gone && (
        <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          This note is no longer at {teamName}. How you organized it is kept.
        </p>
      )}
      <section aria-label={`Shared with ${teamName}`} className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
            <Users size={12} /> Shared with {teamName}
          </span>
          {note.source?.area && <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">{note.source.area.name}</span>}
          {syncedAt && !gone && (
            <span className="text-muted-foreground">
              As of {new Date(syncedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          {href && !gone && (
            <a href={href} className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-foreground hover:bg-muted">
              <PencilLine size={12} aria-hidden /> Edit in {teamName}
            </a>
          )}
        </div>
        <h1 className="note-title text-2xl font-semibold leading-tight">{note.title?.trim() || 'Untitled note'}</h1>
        {!gone && (
          <div className="task-slideout-editor shared-task-editor">
            <RichEditor key={`${note.id}:${note.source?.updatedAt ?? ''}`} content={note.body} attachmentStore={spaceAttachmentStore(note.sourceTeamId!)} editable={false} hideFooter />
          </div>
        )}
      </section>

      <section aria-label="Only you" className="space-y-3 rounded-lg border border-dashed border-border p-4">
        <div>
          <h3 className="flex items-center gap-1.5 text-[12px] font-semibold">
            <Lock size={12} /> Only you
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">How this note is organized in My Ri. {teamName} never sees it.</p>
        </div>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-xs">
          <span className="font-medium text-muted-foreground">Organize for me</span>
          <AreaSelect value={note.areaId ?? null} onChange={(areaId) => updateNote.mutate({ id: note.id, areaId })} />
        </div>
      </section>

      <LinkedReferences entityType="note" entityId={note.id} />
    </div>
  );
}
