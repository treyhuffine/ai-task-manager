import type { PrMentionItem } from './types'

/**
 * Format a PR reference as the single-line context string the agent
 * sees. The PR chip's serializer calls this directly from its attrs
 * (`chat-input-editor.tsx`), so the agent receives title + URL + branch
 * context without an extra `gh pr view` round-trip.
 *
 *   PR chip for #193
 *     →
 *   "PR #193 \"Add SEO footer\" (head: codex/seo-footer, base: main,
 *     state: OPEN) https://github.com/owner/repo/pull/193"
 *
 * A PR chip is only ever created by the user picking one from the `@#`
 * picker (`mention-menu`), so there is no raw-text `#193` expansion path
 * anymore — a number typed as plain text stays exactly as typed.
 */
export function formatPrRef(pr: PrMentionItem): string {
  const draft = pr.isDraft ? ', draft' : ''
  return `PR #${pr.number} "${pr.title}" (head: ${pr.headRefName}, base: ${pr.baseRefName}, state: ${pr.state}${draft}) ${pr.url}`
}
