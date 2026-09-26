'use client';

/**
 * Reviewing it here (docs/homes-spec.md §8.1, P4.1): this computer's checkout
 * of the execution's published commit, labeled with the commit and where the
 * work runs, so it never reads as the execution itself. Refresh brings the
 * latest published commit while there are no edits. Edits are kept: to work
 * on it here, Continue here is the way, and it moves the execution, not this
 * checkout.
 */

import { toast } from 'sonner';
import { Loader2, RefreshCw, SquareArrowOutUpRight } from 'lucide-react';
import { useOpenCodeHere, useReview } from '@/hooks/use-execution';
import { sessionsApi } from '@/lib/api/sessions';
import { clientIsHost, fsApi, type OpenTarget } from '@/lib/api/fs';
import { apiErrorText } from '@/lib/api/client';
import { useEditorPreference } from '@/lib/client/editor-preference';

export function ReviewBar({ sessionId, ownerComputerId }: { sessionId: string; ownerComputerId: string | null }) {
  const { data } = useReview(sessionId);
  const refresh = useOpenCodeHere(sessionId);
  const open = useOpenReview(sessionId);
  const review = data?.review;
  if (!review || !data?.viewer || data.viewer.id === ownerComputerId) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-card px-3 py-1.5 text-[11.5px]">
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
            onSuccess: (s) => toast.success(s.refreshed ? `Now at ${s.review?.sha.slice(0, 7)}` : 'Already the latest published commit'),
            onError: (err) => toast.error("Couldn't refresh it", { description: apiErrorText(err) }),
          })
        }
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground/80 hover:bg-muted/60 disabled:opacity-50"
      >
        {refresh.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Refresh
      </button>
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
