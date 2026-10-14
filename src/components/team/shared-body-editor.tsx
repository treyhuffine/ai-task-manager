'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiErrorCode, apiErrorDetails, apiErrorStatus, apiErrorText } from '@/lib/api/client';
import { patchEntityCaches } from '@/lib/query/optimistic-entity';
import type { Attachment } from '@/db/types';
import { bodyForDocument, bodyForTeam, currentSpaceId } from '@/lib/spaces/document';
import { SharedBodySaver, sharedDraftKey, type SharedBody, type SharedBodyStatus, type WriteFailure } from '@/lib/team/shared-body';
import { trpcClient } from '@/lib/trpc/client';
import { documentSaves } from '@/lib/client/document-saves';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useTeam } from './team-context';

type Kind = 'task' | 'note';

function readFailure(error: unknown): WriteFailure {
  const status = apiErrorStatus(error) ?? undefined;
  if (status === 409 && apiErrorCode(error) === 'body_conflict') {
    const current = apiErrorDetails<{ body?: string | null; bodyRevision?: number }>(error);
    if (current && typeof current.bodyRevision === 'number') {
      return { status, conflict: { body: current.body ?? '', bodyRevision: current.bodyRevision } };
    }
  }
  return { status, message: status ? apiErrorText(error) : undefined };
}

const SAVED: SharedBodyStatus = { status: 'saved' };

/** Where a shared body is saved, and how its text shows in the editor. */
export interface SharedBodyTarget {
  /** One per team, member and record, so a draft keeps its owner and audience. */
  draftKey: string;
  /** Save against the revision the text was edited from. Returns what the shared record now holds, in the editor's form. */
  write(input: { body: string; expectedBodyRevision: number; attachments: Attachment[] }): Promise<SharedBody>;
  /** The editor's form of the shared record's text. */
  toEditor(body: string): string;
}

type SharedRecord = { id: string; body: string | null; bodyRevision: number };

/**
 * A shared body in an editor (docs/homes-spec.md §9.3, P6.4, P7.3): autosaved
 * against the revision it edited and kept through a conflict. An idle editor
 * may follow shared text, acknowledging its revision with the replacement.
 * `editorKey` changes on explicit conflict resolution, so a focused editor
 * is never rewritten underneath someone typing. The same editor serves the
 * team's own app and a shared task in My Ri, by its target.
 */
export function useSharedBodyFor(record: SharedRecord | undefined, target: SharedBodyTarget | null) {
  const [saver, setSaver] = useState<SharedBodySaver | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [initial, setInitial] = useState('');
  // Files dropped into the editor, sent with the next save so the body's
  // record of them keeps their names and types.
  const uploads = useRef<Attachment[]>([]);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);
  const id = record?.id;
  const draftKey = target?.draftKey;

  useEffect(() => {
    if (!record || !target) return;
    // A saver can finish another queued write after this component switches
    // documents. Bind its destination and upload queue to this document.
    const pending: Attachment[] = [];
    uploads.current = pending;
    const writer = async (input: { body: string; expectedBodyRevision: number }): Promise<SharedBody> => {
      const sent = pending.slice();
      const saved = await target.write({ ...input, attachments: sent });
      for (const attachment of sent) {
        const index = pending.indexOf(attachment);
        if (index !== -1) pending.splice(index, 1);
      }
      return saved;
    };
    const next = new SharedBodySaver(
      target.draftKey,
      { body: target.toEditor(record.body ?? ''), bodyRevision: record.bodyRevision },
      writer,
      (err) => {
        const failure = readFailure(err);
        return failure.conflict ? { ...failure, conflict: { ...failure.conflict, body: target.toEditor(failure.conflict.body) } } : failure;
      },
      () => window.localStorage,
    );
    const draft = next.draft();
    if (draft) next.recover(draft);
    setInitial(next.text());
    setEditorKey((k) => k + 1);
    setSaver(next);
    const unregister = documentSaves.register(next);
    return () => {
      unregister();
      void next.flush().catch(() => {});
      next.dispose();
    };
    // A new saver per document, made once its record first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, draftKey]);

  // Offer the shared record to the editor. Its revision advances only when
  // the editor actually applies the text, never merely on a cache refresh.
  const revision = record?.bodyRevision;
  useEffect(() => {
    if (!saver || !record || revision === undefined || !targetRef.current) return;
    if (saver.status().status === 'saved' && revision > saver.revision()) setInitial(targetRef.current.toEditor(record.body ?? ''));
  }, [saver, record, revision]);

  const subscribe = useCallback((listener: () => void) => (saver ? saver.subscribe(listener) : () => {}), [saver]);
  const status = useSyncExternalStore(subscribe, () => saver?.status() ?? SAVED, () => SAVED);

  return useMemo(
    () => ({
      ready: !!saver,
      editorKey,
      initial,
      status,
      edit: (body: string) => saver?.edit(body),
      applyExternalContent: (body: string, apply: () => void) => {
        const toEditor = targetRef.current?.toEditor;
        if (!record || !toEditor || body !== toEditor(record.body ?? '')) return;
        saver?.observe({ body, bodyRevision: record.bodyRevision }, apply);
      },
      onAttachment: (attachment: Attachment) => {
        uploads.current.push(attachment);
      },
      useTheirs: () => {
        if (!saver) return;
        setInitial(saver.useTheirs());
        setEditorKey((k) => k + 1);
      },
      keepMine: () => void saver?.keepMine(),
      retry: () => void saver?.retry(),
    }),
    [saver, editorKey, initial, status, record],
  );
}

/** A shared task or note's body in the team's own app, or a team's space in My Ri. */
export function useSharedBody(kind: Kind, record: SharedRecord | undefined) {
  const { team, member } = useTeam();
  const qc = useQueryClient();
  // Inside My Ri, the team's files are reached through this home
  // (src/lib/spaces/document.ts). The team itself always gets its own form.
  const space = currentSpaceId();
  const recordId = record?.id;
  const target = useMemo<SharedBodyTarget | null>(() => {
    if (!recordId) return null;
    return {
      draftKey: sharedDraftKey({ teamId: team.id, memberId: member.id }, kind, recordId),
      toEditor: (body) => bodyForDocument(body, space),
      write: async ({ body, expectedBodyRevision, attachments }) => {
        const patch = { body: bodyForTeam(body, space), ...(attachments.length > 0 ? { attachments } : {}) };
        const saved = kind === 'task'
          ? await trpcClient.tasks.update.mutate({ id: recordId, patch, expectedBodyRevision })
          : await trpcClient.notes.update.mutate({ id: recordId, patch, expectedBodyRevision });
        // The cache gets the body this editor sent and the new revision, never
        // the server's echo, which must not rewrite an open editor. Lists get
        // its excerpt, so a note typed and closed doesn't read as untitled.
        patchEntityCaches(qc, kind === 'task' ? 'tasks' : 'notes', recordId, { body: bodyForTeam(body, space), bodyRevision: saved.bodyRevision });
        return { body: saved.body != null ? bodyForDocument(saved.body, space) : body, bodyRevision: saved.bodyRevision };
      },
    };
  }, [recordId, kind, team.id, member.id, space, qc]);
  return useSharedBodyFor(record, target);
}

/** Where the shared text stands, quietly, and the choice when it conflicts. */
export function SharedBodyState({ shared }: { shared: ReturnType<typeof useSharedBody> }) {
  const [comparing, setComparing] = useState(false);
  const { status } = shared;
  if (status.status === 'conflict') {
    return (
      <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        <p className="font-medium">Someone else changed this while you were editing. Your text is kept.</p>
        <p className="mt-0.5 text-amber-700/80 dark:text-amber-300/80">Saving is paused until you choose which to keep.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <ConflictButton onClick={() => setComparing(true)}>Compare</ConflictButton>
          <ConflictButton onClick={shared.useTheirs}>Use theirs</ConflictButton>
          <ConflictButton onClick={shared.keepMine}>Keep mine</ConflictButton>
        </div>
        <CompareDialog open={comparing} onOpenChange={setComparing} theirs={status.theirs.body} mine={status.mine} />
      </div>
    );
  }
  if (status.status === 'failed') {
    return (
      <p role="alert" className="text-xs text-red-600 dark:text-red-300">
        {status.message} <button type="button" className="underline" onClick={shared.retry}>Try again</button>
      </p>
    );
  }
  return null;
}

/** "Saved", "Saving…", or why it's waiting. */
export function SaveStatus({ status }: { status: SharedBodyStatus }) {
  const label =
    status.status === 'saving' || status.status === 'pending'
      ? 'Saving…'
      : status.status === 'offline'
        ? "Can't reach the team. Your text is kept"
        : status.status === 'conflict'
          ? 'Not saved'
          : status.status === 'failed'
            ? 'Not saved'
            : 'Saved';
  return (
    <span className={cn('text-[11px]', status.status === 'saved' ? 'text-muted-foreground/70' : 'text-muted-foreground')} aria-live="polite">
      {label}
    </span>
  );
}

function ConflictButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-amber-500/40 bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted/60"
    >
      {children}
    </button>
  );
}

function CompareDialog({ open, onOpenChange, theirs, mine }: { open: boolean; onOpenChange: (open: boolean) => void; theirs: string; mine: string }) {
  const scroll = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Compare</DialogTitle>
          <DialogDescription>The shared version, and the text you were writing. Close this, then choose which to keep.</DialogDescription>
        </DialogHeader>
        <div ref={scroll} className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto md:grid-cols-2">
          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Theirs (shared now)</h3>
            <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs">{theirs || 'Empty'}</pre>
          </section>
          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Yours (kept here)</h3>
            <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs">{mine || 'Empty'}</pre>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
