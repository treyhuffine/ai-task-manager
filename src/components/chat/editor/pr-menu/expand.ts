import type { PrMentionItem } from './types'

/**
 * Match a `#<number>` reference where the `#` is not part of a URL
 * fragment (`/page#193`), a hashtag-style double-hash (`##193`), or a
 * word (e.g. `id#193`). Captures the PR number.
 *
 * The first lookbehind `(?<!PR )` prevents double-expansion: a PR chip
 * serializes to text starting with `PR #193 …`, and without that
 * guard the regex would match the embedded `#193` and re-expand it
 * into nested context.
 *
 * The second lookbehind covers the conservative "not a word char,
 * not another `#`, not a URL `/`" case so we don't over-expand user
 * text that happens to contain `#<digits>` for an unrelated reason.
 */
const PR_REF_RE = /(?<!PR )(?<![\w#/])#(\d+)\b/g

/**
 * Expand `#193` style references to a fuller line the agent can act
 * on without an extra `gh pr view` round-trip. Mirrors the
 * `[[file:...]]` server-side expansion pattern that the execution
 * route already does for file attachments — same idea, just resolved
 * client-side because the composer already has the PR data cached.
 *
 *   "look at #193"
 *     →
 *   "look at PR #193 \"Add SEO footer\" (head: codex/seo-footer,
 *     base: main, state: OPEN) https://github.com/owner/repo/pull/193"
 *
 * Only numbers that match a known PR get expanded — any stray `#42`
 * the user typed for unrelated reasons passes through unchanged.
 * Empty `prs` is a noop, so the helper is safe to call on every
 * send even when gh is unavailable.
 *
 * `literal` is the user's explicit opt-out: dismissing the `#` menu
 * with Escape means the number was meant as plain text, and an escape
 * hatch that still rewrote the message on the way out would not be
 * much of an escape hatch. Picking a PR from the menu inserts a chip,
 * which serializes through `formatPrRef` on its own and is unaffected.
 */
export function expandPrRefs(
  text: string,
  prs: readonly PrMentionItem[],
  opts?: { literal?: boolean },
): string {
  if (!text || prs.length === 0 || opts?.literal) return text
  const byNumber = new Map<number, PrMentionItem>()
  for (const p of prs) byNumber.set(p.number, p)
  return text.replace(PR_REF_RE, (match, numStr: string) => {
    const num = Number(numStr)
    const pr = byNumber.get(num)
    if (!pr) return match
    return formatPrRef(pr)
  })
}

/**
 * Format a PR reference as the single-line context string the agent
 * sees. Exported so the chip serializer can emit the same shape
 * directly from its attrs — keeps the chip path and the manually-typed
 * `#N` path producing identical wire output.
 */
export function formatPrRef(pr: PrMentionItem): string {
  const draft = pr.isDraft ? ', draft' : ''
  return `PR #${pr.number} "${pr.title}" (head: ${pr.headRefName}, base: ${pr.baseRefName}, state: ${pr.state}${draft}) ${pr.url}`
}
