/**
 * GitHub's own state icons for issues and pull requests, shared by the
 * composer chips and the `@#` picker rows. The picker renders in its own
 * React root, so these stay plain components with no providers.
 */

import {
  CircleCheck,
  CircleDot,
  GitPullRequest,
  GitPullRequestDraft,
  GitPullRequestClosed,
  GitMerge,
} from 'lucide-react'
import type { IssueMentionItem, PrMentionItem } from './types'

/** GitHub's colors: open green, merged violet, closed red, draft grey. */
export function PrStateIcon({ state, isDraft }: Pick<PrMentionItem, 'state' | 'isDraft'>) {
  if (state === 'MERGED') return <GitMerge size={11} className="shrink-0 text-violet-500 dark:text-violet-400" />
  if (state === 'CLOSED') return <GitPullRequestClosed size={11} className="shrink-0 text-rose-500 dark:text-rose-400" />
  if (isDraft) return <GitPullRequestDraft size={11} className="shrink-0 text-muted-foreground/80" />
  return <GitPullRequest size={11} className="shrink-0 text-emerald-500 dark:text-emerald-400" />
}

/** GitHub's colors: open green, closed violet. */
export function IssueStateIcon({ state }: Pick<IssueMentionItem, 'state'>) {
  if (state === 'CLOSED') return <CircleCheck size={11} className="shrink-0 text-violet-500 dark:text-violet-400" />
  return <CircleDot size={11} className="shrink-0 text-emerald-500 dark:text-emerald-400" />
}
