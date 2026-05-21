/**
 * Prompt the action bar injects into the chat when the user clicks
 * "Commit" (or "Commit & Push"). The agent reads this, drafts a focused
 * commit message from the diff, and runs `git commit` (and optionally
 * `git push`) via its Bash tool — no modal, no message input.
 *
 * Mirrors the shape of `open-pr.ts`: prompt + diff summary so the agent
 * has context to write a meaningful message even when the user clicks
 * Commit cold (no prior conversation about the change).
 */

interface DiffLineLike { kind: 'add' | 'del' | 'ctx' }
interface DiffHunkLike { lines: readonly DiffLineLike[] }
interface DiffFileLike {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: readonly DiffHunkLike[];
}
interface DiffLike { files: readonly DiffFileLike[] }

export interface CommitPromptInput {
  branch: string;
  diff: DiffLike;
  /** When true, push the branch to origin after the commit lands. */
  andPush?: boolean;
}

export function buildCommitPrompt(input: CommitPromptInput): string {
  const { branch, diff, andPush } = input;
  const summary = summarizeDiff(diff);

  const lines: string[] = [];
  lines.push(
    andPush
      ? 'Commit the uncommitted changes on this branch and push to origin.'
      : 'Commit the uncommitted changes on this branch.',
  );
  lines.push('');
  lines.push('Steps:');
  lines.push('1. Run `git status` and `git diff` to see what changed (the summary below is a guide).');
  lines.push('2. Stage everything: `git add -A`.');
  lines.push('3. Draft a focused commit message — single short subject line (≤72 chars, imperative mood: "Add X", not "Added X"). Add a body only if the change needs more than a sentence to explain.');
  lines.push('4. Run `git commit -m "<message>"` (use a heredoc if the message has multiple lines).');
  if (andPush) {
    lines.push('5. Push: `git push -u origin HEAD`.');
    lines.push('6. Report the resulting commit SHA.');
  } else {
    lines.push('5. Report the resulting commit SHA.');
  }
  lines.push('');
  lines.push('Branch: `' + branch + '`');
  lines.push('');
  lines.push('Diff summary:');
  lines.push(summary);
  return lines.join('\n');
}

function summarizeDiff(diff: DiffLike): string {
  if (!diff.files.length) return '(no changes)';
  const lines: string[] = [];
  let added = 0;
  let removed = 0;
  for (const f of diff.files) {
    let a = 0;
    let d = 0;
    for (const h of f.hunks) {
      for (const ln of h.lines) {
        if (ln.kind === 'add') a++;
        else if (ln.kind === 'del') d++;
      }
    }
    added += a;
    removed += d;
    lines.push(`- ${statusGlyph(f.status)} ${f.path} (+${a} / -${d})`);
  }
  lines.push('');
  lines.push(`${diff.files.length} file${diff.files.length === 1 ? '' : 's'} changed · +${added} / -${removed}`);
  return lines.join('\n');
}

function statusGlyph(status: 'added' | 'modified' | 'deleted' | 'renamed'): string {
  switch (status) {
    case 'added':
      return '[A]';
    case 'modified':
      return '[M]';
    case 'deleted':
      return '[D]';
    case 'renamed':
      return '[R]';
  }
}
