/**
 * Prompt the action bar injects into the chat when the user clicks
 * "Open PR". The agent reads this, drafts a title + body, then runs
 * `gh pr create --title ... --body ...` via its Bash tool — no new MCP
 * surface, no special wiring.
 *
 * The prompt always includes a compact diff summary so the agent has
 * context to draft a meaningful title even when the user clicks Open
 * PR cold (no prior conversation about the change).
 */

/**
 * Permissive subset of the structured-diff shape — both the agentex
 * library's `readonly` variant and the wire-type's mutable variant
 * satisfy this. Keeps us from caring which surface fed the prompt.
 */
interface DiffLineLike { kind: 'add' | 'del' | 'ctx' }
interface DiffHunkLike { lines: readonly DiffLineLike[] }
interface DiffFileLike {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: readonly DiffHunkLike[];
}
interface DiffLike { files: readonly DiffFileLike[] }

export interface OpenPrPromptInput {
  /** The session's branch name (`<workspace>/<session>`). */
  branch: string;
  /** The base branch the worktree was created from. */
  baseBranch: string;
  /** Compact diff to anchor the agent's draft. */
  diff: DiffLike;
  /** Optional: a previously rejected attempt's error message. */
  retryReason?: string;
}

export function buildOpenPrPrompt(input: OpenPrPromptInput): string {
  const { branch, baseBranch, diff, retryReason } = input;
  const summary = summarizeDiff(diff);

  const lines: string[] = [];
  lines.push('Open a pull request for the work on this branch.');
  lines.push('');
  lines.push('Steps:');
  lines.push('1. If the worktree has uncommitted changes, commit them first with a focused message.');
  lines.push('2. Push the branch if it hasn\'t been pushed yet (`git push -u origin HEAD`).');
  lines.push('3. Draft a PR title (≤72 chars, imperative mood — "Add X", not "Added X").');
  lines.push('4. Draft a PR body with: **Summary**, **What changed**, **Why** sections. Keep it tight; this is for review, not a novel.');
  lines.push('5. Run `gh pr create --base ' + baseBranch + ' --head ' + branch + ' --title "<title>" --body "<body>"`.');
  lines.push('6. Report the resulting PR URL.');
  lines.push('');
  lines.push('Branch: `' + branch + '`');
  lines.push('Base: `' + baseBranch + '`');
  lines.push('');
  lines.push('Diff summary:');
  lines.push(summary);
  if (retryReason) {
    lines.push('');
    lines.push('Previous attempt failed: ' + retryReason);
  }
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
