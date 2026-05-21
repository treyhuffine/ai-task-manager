/**
 * Prompt the action bar injects when the user clicks "Resolve conflicts."
 * Two trigger scenarios, both end with the same kind of work (read
 * markers, decide resolution, commit, push) — the prompt branches on
 * `scenario` to give the agent the right starting commands.
 */

export type ConflictScenario =
  /** GitHub reports the PR can't merge cleanly into its base branch.
   *  Agent pulls base, resolves, commits the merge, pushes. */
  | 'pr_vs_base'
  /** Local branch has diverged from `origin/<branch>`. Agent fetches,
   *  merges remote into local, resolves, commits, pushes. */
  | 'local_vs_remote';

export interface ResolveConflictsPromptInput {
  scenario: ConflictScenario;
  branch: string;
  /** Base branch (only used for `pr_vs_base`). */
  baseBranch?: string;
}

export function buildResolveConflictsPrompt(input: ResolveConflictsPromptInput): string {
  const { scenario, branch, baseBranch } = input;
  const lines: string[] = [];

  if (scenario === 'pr_vs_base') {
    lines.push(
      "GitHub reports this PR can't merge cleanly into `" +
        (baseBranch ?? 'main') +
        '`. Pull the base branch into this branch, resolve the conflicts, and push so the PR becomes mergeable again.',
    );
    lines.push('');
    lines.push('Steps:');
    lines.push('1. `git fetch origin ' + (baseBranch ?? 'main') + '`');
    lines.push('2. `git merge origin/' + (baseBranch ?? 'main') + '` — this will fail with conflicts.');
  } else {
    lines.push(
      'The local branch `' +
        branch +
        '` has diverged from `origin/' +
        branch +
        '` — your push was rejected because remote has commits not in local. Pull the remote in, resolve any conflicts, and push.',
    );
    lines.push('');
    lines.push('Steps:');
    lines.push('1. `git fetch origin ' + branch + '`');
    lines.push('2. `git merge origin/' + branch + '` — this may merge cleanly or fail with conflicts.');
  }

  lines.push('3. If there are conflicts: `git status` to see which files are unmerged. Read the conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) and decide the resolution from context. Edit each conflicted file, remove all markers, save.');
  lines.push('4. `git add <files>` to mark resolved.');
  lines.push('5. `git commit` — accept the default merge commit message unless you have a reason to change it.');
  lines.push('6. `git push -u origin HEAD`.');
  lines.push('7. Report the resulting state.');
  lines.push('');
  lines.push('Branch: `' + branch + '`');
  if (scenario === 'pr_vs_base' && baseBranch) {
    lines.push('Base: `' + baseBranch + '`');
  }
  return lines.join('\n');
}
