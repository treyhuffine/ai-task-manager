/**
 * The reference-folders block appended to an execution's system prompt
 * (docs/reference-folders-spec.md §6).
 *
 * This block is the feature. The agent can already read any absolute path —
 * what it can't do is know the folder exists, so it invents the backend's route
 * shape instead of going to look. Naming the folder and saying why you'd read
 * it closes that gap in a few lines of context.
 *
 * Delivered through Claude's `--append-system-prompt` at spawn so it never
 * shows up in the visible transcript, same as `renderContentFocusPrompt`.
 */

import type { ResolvedReferenceFolder } from '@/db/types';

/**
 * One-line git summary, or null when the folder isn't a repo. Drift is the
 * point: a reference sitting on a stale feature branch is the failure mode
 * this line exists to make visible.
 */
export function renderGitLine(ref: ResolvedReferenceFolder): string | null {
  if (!ref.git) return null;
  const parts: string[] = [ref.git.branch ?? 'detached HEAD'];
  parts.push(ref.git.dirty ? 'uncommitted changes' : 'clean');
  if (ref.git.behind != null && ref.git.behind > 0) parts.push(`${ref.git.behind} behind origin`);
  if (ref.git.ahead != null && ref.git.ahead > 0) parts.push(`${ref.git.ahead} ahead of origin`);
  return `git: ${parts.join(', ')}`;
}

function renderEntry(ref: ResolvedReferenceFolder): string {
  const lines = [`- ${ref.alias}  ->  ${ref.absolutePath}`];
  if (ref.description) lines.push(`  ${ref.description}`);
  const gitLine = renderGitLine(ref);
  if (gitLine) lines.push(`  ${gitLine}`);
  return lines.join('\n');
}

/**
 * Render the block, or an empty string when there is nothing usable to say.
 * Callers should treat empty as "append nothing" so a workspace with no
 * reference folders pays no context at all.
 *
 * Expects rows already filtered to existing paths (see
 * `listUsableReferenceFolders`) — a broken reference is dropped upstream
 * rather than described here.
 */
export function renderReferenceFoldersPrompt(refs: ResolvedReferenceFolder[]): string {
  if (refs.length === 0) return '';

  const entries = refs.map(renderEntry).join('\n');
  return `# Reference folders (read-only)

Folders outside your working directory that you may read and search. They are
listed here because their contents are relevant to work in this workspace, so
check them rather than guessing at what they contain.

Do not modify anything in them. If a change is needed in one, say so instead of
making it.

${entries}`;
}
