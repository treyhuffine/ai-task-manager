/**
 * The linked-folders block added to a session's instructions
 * (docs/reference-folders-spec.md §6).
 *
 * This block is the feature. The agent can already read any absolute path —
 * what it can't do is know the folder exists, so it invents the backend's route
 * shape instead of going to look. Naming the folder and saying why you'd read
 * it closes that gap in a few lines of context.
 *
 * A folder is editable unless the person marked it read only. The two kinds
 * get different rules, so a mixed list is split into two sections.
 *
 * Delivered through the session's instructions file at spawn so it never
 * shows up in the visible transcript.
 */

import type { ResolvedReferenceFolder } from '@/db/types';
import { isReadOnly } from '@/lib/reference-folders/read-only';

/** What the block says about a folder. A folder resolved on another device has no Git summary. */
export type PromptReferenceFolder = Pick<ResolvedReferenceFolder, 'alias' | 'absolutePath' | 'description' | 'git'> & {
  readOnly?: boolean | null;
};

/**
 * One-line git summary, or null when the folder isn't a repo. Drift is the
 * point: a reference sitting on a stale feature branch is the failure mode
 * this line exists to make visible.
 */
export function renderGitLine(ref: PromptReferenceFolder): string | null {
  if (!ref.git) return null;
  const parts: string[] = [ref.git.branch ?? 'detached HEAD'];
  parts.push(ref.git.dirty ? 'uncommitted changes' : 'clean');
  if (ref.git.behind != null && ref.git.behind > 0) parts.push(`${ref.git.behind} behind origin`);
  if (ref.git.ahead != null && ref.git.ahead > 0) parts.push(`${ref.git.ahead} ahead of origin`);
  return `git: ${parts.join(', ')}`;
}

function renderEntry(ref: PromptReferenceFolder): string {
  const lines = [`- ${ref.alias}  ->  ${ref.absolutePath}`];
  if (ref.description) lines.push(`  ${ref.description}`);
  const gitLine = renderGitLine(ref);
  if (gitLine) lines.push(`  ${gitLine}`);
  return lines.join('\n');
}

const INTRO = `Folders outside your working directory that are part of this work. Read and
search them rather than guessing at what they contain.`;

const EDITABLE_RULES = `You may change these when the work calls for it. Each is a shared folder, not
a copy of your own, so an edit lands in whatever is checked out there, beside
any other work in progress. Don't switch a Git folder's branch. If a change
belongs on another branch, make a worktree of that repository and work there.`;

const READ_ONLY_RULES = `Do not modify anything in these. If a change is needed in one, say so instead
of making it.`;

/**
 * Render the block, or an empty string when there is nothing usable to say.
 * Callers should treat empty as "append nothing" so a workspace with no
 * reference folders pays no context at all.
 *
 * Expects rows already filtered to existing paths (see
 * `listUsableReferenceFolders`) — a broken reference is dropped upstream
 * rather than described here.
 */
export function renderReferenceFoldersPrompt(refs: PromptReferenceFolder[]): string {
  if (refs.length === 0) return '';

  const editable = refs.filter((r) => !isReadOnly(r)).map(renderEntry).join('\n');
  const readOnly = refs.filter(isReadOnly).map(renderEntry).join('\n');

  if (!readOnly) return `# Linked folders\n\n${INTRO}\n\n${EDITABLE_RULES}\n\n${editable}`;
  if (!editable) return `# Linked folders (read only)\n\n${INTRO}\n\n${READ_ONLY_RULES}\n\n${readOnly}`;
  return [
    `# Linked folders\n\n${INTRO}`,
    `## Editable\n\n${EDITABLE_RULES}\n\n${editable}`,
    `## Read only\n\n${READ_ONLY_RULES}\n\n${readOnly}`,
  ].join('\n\n');
}
