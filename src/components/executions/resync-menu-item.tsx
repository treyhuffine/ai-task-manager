'use client';

import { RefreshCw, Loader2, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useResyncSession } from '@/hooks/use-execution';

/**
 * "Resync this session" — under the 3-dot menu. Safety hatch for when
 * the user perceives a session as stuck and the automated health
 * checks haven't healed it. Force-closes the cached subprocess,
 * force-reconciles, bypasses the orphan-redispatch throttle.
 *
 * On an imported chat there is no subprocess to close: the work is
 * happening in whatever terminal the user started it in, and the only
 * job here is to pull the transcript forward. The tooltip says which
 * one it is, because promising to kill a subprocess that doesn't exist
 * is how a no-op reads as a fix.
 *
 * Feedback is intentionally minimal: a transient inline "Resynced ✓"
 * for 2s on success, error inline on failure. No toast, no modal —
 * Resync should feel like a private gesture the user makes when they
 * suspect something's off, not a ceremonial action.
 */
export function ResyncMenuItem({
  sessionId,
  imported = false,
}: {
  sessionId: string;
  imported?: boolean;
}) {
  const resync = useResyncSession(sessionId);
  const [doneAt, setDoneAt] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = () => {
    resync.mutate(undefined, {
      onSuccess: () => {
        setDoneAt(Date.now());
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setDoneAt(null), 2000);
      },
    });
  };

  const isPending = resync.isPending;
  const showDone = !isPending && doneAt !== null;
  const error = resync.error;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[12px] text-foreground hover:bg-muted/50 disabled:opacity-60 disabled:cursor-not-allowed text-left"
      title={imported
        ? 'Pull anything new from the provider transcript this chat was imported from. Use when the terminal running it is ahead of what you see here.'
        : "Force-resync this session. Kills the current Claude subprocess (interrupting any turn in flight), replays the transcript from disk, and redispatches any unanswered user message. Use when the session feels stuck and the automatic recovery hasn't caught up."}
    >
      <span className="flex items-center gap-2">
        {isPending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : showDone ? (
          <Check size={12} className="text-emerald-600" />
        ) : (
          <RefreshCw size={12} />
        )}
        <span>
          {isPending ? 'Resyncing…' : showDone ? 'Resynced' : 'Resync session'}
        </span>
      </span>
      {error && !isPending && (
        <span className="text-[10.5px] text-destructive truncate max-w-[60%]">
          {error instanceof Error ? error.message : String(error)}
        </span>
      )}
    </button>
  );
}
