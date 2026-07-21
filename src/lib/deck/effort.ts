/**
 * Effort bands — the only task-duration arithmetic in the app.
 *
 * Per-task minute estimates were removed deliberately (see the retrenchment
 * note in docs/calendar-view-spec.md): precise numbers are the kind of
 * judgment both humans and LLMs reliably get wrong, and the UI ends up
 * rendering low-confidence guesses with high-confidence pixels. What remains
 * is the categorical `effort` label (XS-XL), which the AI assigns visibly and
 * the user can correct, mapped here to deliberately rough bands for the few
 * places that need fit math (deck sizing, reconcile). Copy that surfaces
 * these numbers should say "roughly", because they are.
 */

// DB enum values plus the XS-XL display shorthand the UI renders.
const EFFORT_MINUTES: Record<string, number> = {
  TRIVIAL: 15,
  SMALL: 30,
  MEDIUM: 60,
  LARGE: 120,
  EPIC: 240,
  XS: 15,
  S: 30,
  M: 60,
  L: 120,
  XL: 240,
};

/** Unknown effort reads as a medium-short task, not a precise claim. */
export const DEFAULT_EFFORT_MINUTES = 30;

export function effortMinutes(effort: string | null | undefined): number {
  if (!effort) return DEFAULT_EFFORT_MINUTES;
  return EFFORT_MINUTES[effort.trim().toUpperCase()] ?? DEFAULT_EFFORT_MINUTES;
}
