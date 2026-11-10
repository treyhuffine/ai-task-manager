/**
 * The `@`-picker folds GitHub issues and pull requests in as one more kind,
 * reachable by typing `#` right after the `@`. Keeping the discriminator in
 * one place so the ranking (which enters this mode) and the issue and PR
 * chips' Backspace re-trigger (which reopens the picker in it) can't drift
 * apart.
 *
 * `#` is GitHub's own syntax for both, and the two share one number space in
 * a repository, so `@#193` names exactly one of them. Gating them behind the
 * prefix keeps the default `@` list (files, tasks, notes) uncluttered.
 */

/** The `@`-picker lists issues and pull requests when its query begins with this. */
export const GITHUB_QUERY_PREFIX = '#';

/** Full trigger string (`@` + prefix) that reopens the picker on issues and PRs. */
export const MENTION_GITHUB_TRIGGER = '@' + GITHUB_QUERY_PREFIX;
