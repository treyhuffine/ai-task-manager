/**
 * Wire shape for a pull request surfaced in the `@#` picker
 * (`mention-menu`). Mirrors the relevant subset of `PrListItem` from
 * `/api/sessions/:id/prs` so the picker stays decoupled from the
 * route's response type.
 *
 * `baseRefName` and `url` aren't shown in the picker row — they're
 * carried through so the inserted PR chip can serialize to a full
 * context line at send time (`formatPrRef`).
 */
export interface PrMentionItem {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  headRefName: string
  baseRefName: string
  url: string
  updatedAt: string
}

/**
 * Wire shape for an issue surfaced in the same `@#` picker. Mirrors
 * `IssueListItem` from `sessions.issuesGet`. Like a PR, the chip carries
 * the `url` so it serializes to a full context line (`formatIssueRef`)
 * without reading the list again at send time.
 */
export interface IssueMentionItem {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED'
  url: string
  updatedAt: string
}
