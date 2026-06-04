/**
 * Shared PR-status value types — CI check rollup and review decision.
 *
 * Kept in a types-only module (no `node:` imports) so both the server
 * side-call (`pr-mergeable.ts`, which shells out to `gh`) and the client
 * API layer (`lib/api/sessions.ts`, which renders the action bar) can
 * import the same shapes without pulling Node into the browser bundle.
 */

/** Rolled-up CI state across all of a PR's checks. */
export type PrCiState = 'passing' | 'failing' | 'pending';

export interface PrChecks {
  /** `failing` if any check failed, else `pending` if any is still running, else `passing`. */
  state: PrCiState;
  total: number;
  passed: number;
  failed: number;
  pending: number;
}

/**
 * GitHub's PR review decision. `review_required` means the PR's branch
 * protection requires a review that hasn't landed yet. `null` (not part of
 * this type) is used by callers when GitHub reports no decision at all.
 */
export type PrReviewDecision = 'approved' | 'changes_requested' | 'review_required';
