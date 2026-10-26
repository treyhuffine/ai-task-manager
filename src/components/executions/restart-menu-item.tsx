'use client';

import { Power, Loader2, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRestartSession } from '@/hooks/use-execution';
import { Tip } from '@/components/ui/tip';

/**
 * "Restart chat", in the chat's menu: the execution header's, or the chat
 * menu every other chat has. Stops the chat's harness; the next message
 * starts a fresh one that resumes the conversation from disk, so nothing is
 * lost. The manual way to recycle it: pick up an in-place binary upgrade or
 * clear a long-lived process.
 *
 * Also the check for a chat blocked on a harness that hasn't confirmed it
 * stopped, where `ChatRecovery` shows it inline. A send retries that same
 * check by itself, so pressing it is never required.
 *
 * Sits above Resync. Restart is the proactive "fresh process" gesture;
 * Resync is the reactive "this is stuck, recover it" gesture (which also
 * replays the transcript and re-fires unanswered messages).
 *
 * Feedback mirrors Resync: a transient inline "Restarted ✓" for 2s, error
 * inline on failure. No toast — it's a quiet, private gesture.
 */
type RestartProps = { sessionId: string; active?: boolean };

export function RestartMenuItem(props: RestartProps) {
  return <ChatRestart key={props.sessionId} {...props} />;
}

function ChatRestart({ sessionId, active = true }: RestartProps) {
  const restart = useRestartSession(sessionId);
  const [doneAt, setDoneAt] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = () => {
    setDoneAt(null);
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
  // Contextual rows stay mounted so success remains visible after recovery
  // clears their trigger. Menus retain their normal always-active behavior.
  if (!active && !isPending && !showDone) return null;

  return (
    <Tip label="Stops this chat's harness, interrupting any work in progress. Your next message starts it again with this conversation's history. Use this to recover a stuck chat or pick up a harness update.">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[12px] text-foreground hover:bg-muted/50 disabled:opacity-60 disabled:cursor-not-allowed text-left"
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
            {isPending ? 'Restarting…' : showDone ? 'Restarted' : 'Restart chat'}
          </span>
        </span>
        {error && !isPending && (
          <span className="text-[10.5px] text-destructive truncate max-w-[60%]">
            {error instanceof Error ? error.message : String(error)}
          </span>
        )}
      </button>
    </Tip>
  );
}
