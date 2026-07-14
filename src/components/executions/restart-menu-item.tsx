'use client';

import { Power, Loader2, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRestartSession } from '@/hooks/use-execution';

/**
 * "Restart agent" — under the 3-dot menu. We keep coding sessions open for
 * the life of the server (snappy reuse, no idle spin-down), so this is the
 * manual way to recycle the CLI subprocess: pick up an in-place binary
 * upgrade or clear a process's accumulated working memory. Kills the
 * current process; the next message spawns a fresh one that resumes the
 * conversation from disk, so nothing is lost.
 *
 * Sits above Resync. Restart is the proactive "fresh process" gesture;
 * Resync is the reactive "this is stuck, recover it" gesture (which also
 * replays the transcript and re-fires unanswered messages).
 *
 * Feedback mirrors Resync: a transient inline "Restarted ✓" for 2s, error
 * inline on failure. No toast — it's a quiet, private gesture.
 */
export function RestartMenuItem({ sessionId }: { sessionId: string }) {
  const restart = useRestartSession(sessionId);
  const [doneAt, setDoneAt] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = () => {
    restart.mutate(undefined, {
      onSuccess: () => {
        setDoneAt(Date.now());
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setDoneAt(null), 2000);
      },
    });
  };

  const isPending = restart.isPending;
  const showDone = !isPending && doneAt !== null;
  const error = restart.error;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[12px] text-foreground hover:bg-muted/50 disabled:opacity-60 disabled:cursor-not-allowed text-left"
      title="Restart the agent process. Kills the current Claude/Codex subprocess (interrupting any turn in flight) so your next message starts a fresh one, resuming this conversation from disk. Use to pick up a CLI update or clear the process's working memory."
    >
      <span className="flex items-center gap-2">
        {isPending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : showDone ? (
          <Check size={12} className="text-emerald-600" />
        ) : (
          <Power size={12} />
        )}
        <span>
          {isPending ? 'Restarting…' : showDone ? 'Restarted' : 'Restart agent'}
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
