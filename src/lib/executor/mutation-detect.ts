/**
 * Classifier for "did this tool-use event likely change files on disk?"
 *
 * Used by `useSessionStream` to decide whether to invalidate the file
 * tree query immediately when an event arrives, so the UI updates in
 * the same frame as the agent's edit instead of waiting for the slow
 * 30s poll.
 *
 * False positives are cheap (we'd just refetch a tree that hasn't
 * changed). False negatives mean the tree lags up to 30s. Bias toward
 * over-invalidation.
 */

import type { ChatEventRecord } from '@/db/types';

/** Tool names that always mutate files. */
const ALWAYS_MUTATING = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  // Codex-style file write tool
  'apply_patch',
]);

/**
 * Substring fragments that, when present in an MCP tool name, indicate
 * a file-system write. MCP tool names look like
 * `mcp__<server>__<tool>` — we match the tool half.
 */
const MCP_WRITE_FRAGMENTS = [
  'write_file',
  'edit_file',
  'create_file',
  'delete_file',
  'move_file',
  'rename_file',
  'patch_file',
  'apply_patch',
];

/**
 * Regex fragments that identify a Bash command as mutating. We match
 * against the first word (the executable) and the broader command body
 * for things like redirection. Conservative — `git checkout` may or may
 * not mutate the working tree; we treat it as mutating because the
 * common case (switching branches) does.
 */
const MUTATING_BASH_PATTERNS: RegExp[] = [
  /\brm\b/, // rm / rm -rf
  /\bmv\b/,
  /\bmkdir\b/,
  /\btouch\b/,
  /\bcp\b/,
  /\bln\b/,
  /\bgit\s+checkout\b/,
  /\bgit\s+reset\b/,
  /\bgit\s+stash\b/,
  /\bgit\s+restore\b/,
  /\bgit\s+pull\b/,
  /\bgit\s+merge\b/,
  /\bgit\s+rebase\b/,
  /\bgit\s+apply\b/,
  /\bgit\s+commit\b/,
  /\bnpm\s+install\b/,
  /\bpnpm\s+(install|add|remove|update|i\b)/,
  /\byarn\s+(install|add|remove|upgrade)\b/,
  /\bnpx\s+/,
  /\s>\s/, // stdout redirection to a file
  /\s>>\s/,
  /\btee\b/,
  /\bsed\s+-i\b/,
  /\bperl\s+.*-i\b/,
];

function isBashMutating(command: string): boolean {
  return MUTATING_BASH_PATTERNS.some((re) => re.test(command));
}

function extractBashCommand(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const cmd = (input as Record<string, unknown>).command;
  if (typeof cmd !== 'string') return null;
  return cmd;
}

export function isMutatingToolUse(event: Pick<ChatEventRecord, 'source' | 'toolName' | 'toolInput'>): boolean {
  // Only consider tool-call rows; tool-result rows don't trigger another mutation.
  if (event.source !== 'tool_call') return false;
  const name = event.toolName;
  if (!name) return false;

  if (ALWAYS_MUTATING.has(name)) return true;

  if (name.startsWith('mcp__')) {
    const lower = name.toLowerCase();
    if (MCP_WRITE_FRAGMENTS.some((f) => lower.includes(f))) return true;
  }

  if (name === 'Bash' || name === 'shell') {
    const cmd = extractBashCommand(event.toolInput);
    if (cmd && isBashMutating(cmd)) return true;
  }

  return false;
}
