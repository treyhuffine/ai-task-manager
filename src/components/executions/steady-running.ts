'use client';

import { useEffect, useState } from 'react';

/** How long a turn still reads as working after running drops with no outcome. */
export const STEADY_RUNNING_HOLD_MS = 1_500;

/**
 * Whether a drop in "running" should be held, given what was seen before.
 * Only a drop with no new outcome is: a turn that really ended brings its
 * outcome with it, and one that comes back was never over.
 */
export function holdsRunning(seen: { running: boolean; outcome: string | null }, running: boolean, outcome: string | null): boolean {
  return seen.running && !running && seen.outcome === outcome;
}

/**
 * A turn's running flag without the gap a harness leaves at a turn boundary
 * inside one piece of work (P3.7): when a message queued during a turn is
 * folded into it, the runner can read not-running for a few hundred
 * milliseconds while the harness goes on. Shown as it came, the header said
 * "Not started" in that gap. A drop with no new outcome is held briefly, and
 * anything that ends the turn for real (its outcome, or running again) ends
 * the hold at once.
 */
export function useSteadyRunning(running: boolean, outcome: string | null): boolean {
  const [seen, setSeen] = useState({ running, outcome });
  const [held, setHeld] = useState(false);
  if (seen.running !== running || seen.outcome !== outcome) {
    setSeen({ running, outcome });
    setHeld(holdsRunning(seen, running, outcome));
  }
  useEffect(() => {
    if (!held) return;
    const t = setTimeout(() => setHeld(false), STEADY_RUNNING_HOLD_MS);
    return () => clearTimeout(t);
  }, [held]);
  return running || held;
}
