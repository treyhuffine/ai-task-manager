/**
 * The `@`-picker folds pull requests in as one more kind, reachable by
 * typing `#` right after the `@`. Keeping the discriminator in one place
 * so the ranking (which enters PR mode) and the PR chip's Backspace
 * re-trigger (which reopens the picker in PR mode) can't drift apart.
 *
 * `#` is GitHub's own PR/issue syntax, so `@#193` reads naturally, and
 * gating PRs behind the prefix keeps the default `@` list — files,
 * tasks, notes — uncluttered.
 */

/** The `@`-picker enters PR mode when its query begins with this prefix. */
export const PR_QUERY_PREFIX = '#';

/** Full trigger string (`@` + prefix) that reopens the picker in PR mode. */
export const MENTION_PR_TRIGGER = '@' + PR_QUERY_PREFIX;
