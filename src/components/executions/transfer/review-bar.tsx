'use client';

/**
 * Reviewing it here (docs/homes-spec.md §8.1, P4.1): this computer's checkout
 * of the execution's published commit, labeled with the commit and where the
 * work runs, so it never reads as the execution itself. Refresh brings the
 * latest published commit while there are no edits. Edits are kept and never
 * published to the execution's branch. To edit, the two ways are Continue
 * here, which moves the execution into a clean worktree of its own, or an
 * ordinary Git branch of your own in this checkout.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowRightLeft, Copy, Loader2, RefreshCw, SquareArrowOutUpRight } from 'lucide-react';
import { useOpenCodeHere, useReview } from '@/hooks/use-execution';
import { sessionsApi } from '@/lib/api/sessions';
import { clientIsHost, fsApi, type OpenTarget } from '@/lib/api/fs';
import { apiErrorText } from '@/lib/api/client';
import { useEditorPreference } from '@/lib/client/editor-preference';
import type { ChatSessionWithExecution, WorkspaceRecord } from '@/db/types';
import { ContinueDialog } from './continue-dialog';
import { useMoves } from './location-menu';

export function ReviewBar({ session, workspace }: { session: ChatSessionWithExecution; workspace: WorkspaceRecord | null | undefined }) {
  const sessionId = session.id;
  const { data } = useReview(sessionId);
  const refresh = useOpenCodeHere(sessionId);
  const open = useOpenReview(sessionId);
  const { owner, moves } = useMoves(session, workspace);
  const [continuing, setContinuing] = useState(false);
  const review = data?.review;
  if (!review || !data?.viewer || data.viewer.id === owner?.computerId) return null;
  // Moving it to the computer this review is on.
  const here = moves.find((m) => m.key === data.viewer!.id && !m.needsSetup) ?? null;
  const ownBranch = `git switch -c ${review.branch}-mine`;

  return (
    <div className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-card px-3 py-1.5 text-[11.5px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-foreground/85">
          Reviewing <span className="font-mono">{review.sha.slice(0, 7)}</span> from {review.source?.name ?? 'its computer'} here
        </span>
        {review.dirty && <span className="text-amber-600 dark:text-amber-400">· has your edits, kept apart from the execution</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => open(review.path)}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground/80 hover:bg-muted/60"
        >
          <SquareArrowOutUpRight size={11} /> Open
        </button>
        <button
          type="button"
          disabled={refresh.isPending || review.dirty}
          title={review.dirty ? "It has your edits, so Refresh leaves it as it is." : 'Bring the latest published commit'}
          onClick={() =>
            refresh.mutate(undefined, {
              onSuccess: (s) =>
                s.review?.dirty
                  ? toast.message('It has your edits, so it stayed as it was')
                  : s.inTheWay?.length
                    ? toast.message('It stayed as it was', {
                        description: `The newer commit would replace local files here: ${s.inTheWay.slice(0, 3).join(', ')}${s.inTheWay.length > 3 ? ` and ${s.inTheWay.length - 3} more` : ''}. Move them aside to refresh.`,
                      })
                    : toast.success(s.refreshed ? `Now at ${s.review?.sha.slice(0, 7)}` : 'Already the latest published commit'),
              onError: (err) => toast.error("Couldn't refresh it", { description: apiErrorText(err) }),
            })
          }
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground/80 hover:bg-muted/60 disabled:opacity-50"
        >
          {refresh.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Refresh
        </button>
        {here && (
          <button
            type="button"
            disabled={!!here.problem}
            title={here.problem ?? `Move the execution to ${here.to.name}, into a clean worktree of its own, to work on it here.`}
            onClick={() => setContinuing(true)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground/80 hover:bg-muted/60 disabled:opacity-50"
          >
            <ArrowRightLeft size={11} /> Continue here
          </button>
        )}
      </div>
      {review.dirty && (
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
          To keep these edits, put them on a branch of your own:
          <code className="rounded bg-muted px-1 py-px font-mono text-[10.5px] text-foreground/80">{ownBranch}</code>
          <button
            type="button"
            title="Copy"
            onClick={() => void navigator.clipboard?.writeText(ownBranch).then(() => toast.success('Copied'))}
            className="rounded p-0.5 hover:bg-muted/60"
          >
            <Copy size={10} />
          </button>
          They never go to the execution&apos;s branch.
        </p>
      )}
      {continuing && here && owner && (
        <ContinueDialog sessionId={sessionId} open={continuing} onOpenChange={setContinuing} to={here.to} from={owner.name} />
      )}
    </div>
  );
}

/** Open a review checkout in the person's editor: here when this is the home's browser, else through this computer's worker. */
export function useOpenReview(sessionId: string): (path: string) => void {
  const { choice } = useEditorPreference();
  const target: OpenTarget = choice === 'custom' ? 'finder' : choice;
  return (path: string) => {
    const run = clientIsHost() ? fsApi.openIn(path, target) : sessionsApi.openReview(sessionId, target);
    void run
      .then((res) => {
        if (!res.ok) toast.error(res.message ?? "Couldn't open it");
      })
      .catch((err) => toast.error("Couldn't open it", { description: apiErrorText(err) }));
  };
}
