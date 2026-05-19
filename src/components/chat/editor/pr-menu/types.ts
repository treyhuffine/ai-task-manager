/**
 * Wire shape for an item in the `#`-mention PR popup. Mirrors the
 * relevant subset of `PrListItem` from `/api/sessions/:id/prs` so the
 * extension stays decoupled from the route's response type.
 *
 * `baseRefName` and `url` aren't shown in the popup — they're carried
 * through so the composer can expand `#<number>` references to a
 * full context line at send time (`expandPrRefs`).
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
