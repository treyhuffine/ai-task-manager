'use client';

import { useState } from 'react';
import { Laptop, Loader2, RotateCw, XCircle } from 'lucide-react';
import { useTakeover } from '@/hooks/use-takeover';
import { ApiError } from '@/lib/api/client';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import type { ChatSessionWithExecution } from '@/db/types';

interface TakeoverBannerProps {
  session: ChatSessionWithExecution;
}

/**
 * Persistent strip above the transcript that surfaces "this session
 * is being worked on locally" plus the Resume / Cancel actions. The
 * action bar is hidden whenever this is shown — see
 * `useExecutionActions`'s `takenOver` ActionState.
 */
export function TakeoverBanner({ session }: TakeoverBannerProps) {
  const { resume, cancel } = useTakeover(session.id);
  const [error, setError] = useState<string | null>(null);

  if (!session.takeoverStartedAt || !session.takeoverToken) return null;

  const handleResume = () => {
    setError(null);
    resume.mutate(session.takeoverToken!, {
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) {
          const body = err.body as { message?: string } | null;
          setError(body?.message ?? 'Pull conflict on the host.');
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      },
    });
  };

  const handleCancel = () => {
    if (
      !confirm(
        'Cancel this takeover? The remote branch and any local clone are left as-is. The agent resumes from where it was paused.',
      )
    )
      return;
    setError(null);
    cancel.mutate(undefined, {
      onError: (err) => setError(err instanceof Error ? err.message : String(err)),
    });
  };

  const isPending = resume.isPending || cancel.isPending;

  return (
    <div className="flex-shrink-0 border-b border-amber-500/40 bg-amber-500/10">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
        <Laptop size={12} className="text-amber-600 dark:text-amber-400" />
        <span className="text-foreground/85 flex-1 min-w-0">
          <span className="font-medium">Taken over locally</span>
          <span className="text-muted-foreground/85">
            {' '}
            · started {formatCompactRelative(session.takeoverStartedAt)} ago
          </span>
        </span>
        <button
          type="button"
          onClick={handleResume}
          disabled={isPending}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {resume.isPending ? <Loader2 size={10} className="animate-spin" /> : <RotateCw size={10} />}
          Resume
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isPending}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-60"
        >
          <XCircle size={10} />
          Cancel
        </button>
      </div>
      {error && (
        <div className="px-3 pb-1.5 text-[10.5px] text-destructive">{error}</div>
      )}
    </div>
  );
}
