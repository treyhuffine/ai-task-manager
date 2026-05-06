'use client';

import { useEffect, useState } from 'react';
import { ThinkingDots } from './thinking-dots';

interface ThinkingStateProps {
  /** ISO timestamp from which to count elapsed seconds. */
  since: string;
}

/**
 * "Agent is starting up / between turns" indicator with a live elapsed
 * counter. Renders when the runtime says a turn is in flight but no
 * assistant-side event has arrived yet (i.e., the user just sent and
 * we're waiting for the first sign of life from the agent).
 *
 * Visual is minimal on purpose: animated dots + monospaced elapsed
 * time. Reads as "the chat is thinking" rather than "data is loading,"
 * which matches what's actually happening.
 */
export function ThinkingState({ since }: ThinkingStateProps) {
  const [elapsed, setElapsed] = useState(() => secondsSince(since));

  useEffect(() => {
    const tick = () => setElapsed(secondsSince(since));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since]);

  return (
    <div className="flex items-center gap-2 text-muted-foreground/70">
      <ThinkingDots />
      <span className="font-mono text-[11px]">{elapsed}s</span>
    </div>
  );
}

function secondsSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}
