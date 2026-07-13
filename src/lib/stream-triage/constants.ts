/**
 * Stream triage cadence + graduation constants. One place, per
 * docs/streaming-spec-tasks.md §3.15 (resolved decision 6).
 */

/** Rolling debounce: a sweep fires this long after the most recent capture. */
export const SWEEP_DEBOUNCE_MINUTES = 20;

/** Pending count at or above this fires the sweep immediately, mid-debounce. */
export const SWEEP_PENDING_THRESHOLD = 10;

/** Max pending items one pass considers. More than this is logged in the
 *  pass summary and left for the next sweep — no silent truncation. */
export const SWEEP_ITEM_CAP = 50;

/** Recent corrections/undos fed to the agent as few-shot examples. */
export const CORRECTIONS_FEWSHOT_LIMIT = 30;

/** Per-item candidate counts for the context builder. */
export const COMBINE_CANDIDATE_LIMIT = 5;
export const MERGE_CANDIDATE_LIMIT = 5;

// ── Graduation thresholds (spec §1.5) ────────────────────────

export const GRADUATE_SUGGEST_TO_AUTO = { minSample: 20, minRate: 0.9 } as const;
export const GRADUATE_AUTO_TO_SILENT = { minSample: 50, minRate: 0.97 } as const;
/** Trailing-window regression that automatically drops one level. A small
 *  minimum sample so trust loss reacts fast without flapping on one undo. */
export const DEMOTE_TRAILING = { window: 20, minSample: 5, belowRate: 0.8 } as const;
