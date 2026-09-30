/**
 * Telling Git failures apart, the same way wherever the Git ran: here, or
 * on the device an execution runs on (P4.5).
 */

function readStderr(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const raw = (err as { stderr?: unknown }).stderr;
    if (typeof raw === 'string') return raw;
    if (raw instanceof Buffer) return raw.toString();
  }
  return '';
}

/** A push the remote rejected because it has commits this branch doesn't. */
export function looksLikeNonFastForward(err: unknown): boolean {
  const stderr = readStderr(err).toLowerCase();
  if (stderr.length === 0) return false;
  return stderr.includes('non-fast-forward') || stderr.includes('updates were rejected') || stderr.includes('rejected');
}

/**
 * A plain `git push` refused because the branch tracks a differently named
 * one: a worktree started from `origin/main` tracks it until its first push.
 */
export function looksLikeUpstreamMismatch(err: unknown): boolean {
  return readStderr(err).toLowerCase().includes('upstream branch of your current branch does not match');
}
