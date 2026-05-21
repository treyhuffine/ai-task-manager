/**
 * Prompt the error modal injects when the user clicks "Solve with agent."
 * The action bar tried to run a programmatic git/gh operation (pull,
 * push, retry-setup, etc.), it failed with a 400 or similar, and the
 * user wants the agent to investigate the cause and fix it.
 *
 * The prompt is intentionally open-ended — we don't pre-diagnose. The
 * agent gets the operation name, the raw error text, and free rein to
 * inspect the worktree (`git remote -v`, `git config`, `gh auth status`,
 * etc.) before deciding what to do.
 */

export interface HelpWithErrorPromptInput {
  /** The action the user tried — "Pull base", "Push", "Open PR", etc.
   *  Used in the prompt's opening sentence so the agent knows the
   *  context, not as a structured field. */
  action: string;
  /** The raw error text from the API response — usually `body.message`
   *  but may fall back to the HTTP status line when no body. Rendered
   *  verbatim inside a fenced code block. */
  error: string;
  /** Optional details the caller wants to surface alongside the error
   *  (branch name, target branch, etc.). One line per entry. */
  context?: ReadonlyArray<{ label: string; value: string }>;
}

export function buildHelpWithErrorPrompt(input: HelpWithErrorPromptInput): string {
  const { action, error, context } = input;
  const lines: string[] = [];

  lines.push(
    'A "' + action + "\" action from the action bar failed. Please investigate the cause and either fix it directly or tell me what's needed.",
  );
  lines.push('');
  lines.push('Error:');
  lines.push('```');
  lines.push(error.trim());
  lines.push('```');

  if (context && context.length > 0) {
    lines.push('');
    lines.push('Context:');
    for (const entry of context) {
      lines.push('- ' + entry.label + ': `' + entry.value + '`');
    }
  }

  lines.push('');
  lines.push("Suggested first steps (use what's relevant):");
  lines.push('- `git remote -v` and `git status` to see the current remotes and branch state.');
  lines.push('- `git config --get remote.origin.url` to verify the remote URL is correct.');
  lines.push('- `gh auth status` if the error looks GitHub-related.');
  lines.push('- For `couldn\'t find remote ref` errors, check whether the ref exists with `git ls-remote origin` and try fetching the actual branch (often `main` or `master`, not `origin/<base>`).');
  lines.push('- If you can fix it autonomously, do so. Otherwise explain the cause and the minimal fix the user needs to apply.');

  return lines.join('\n');
}
