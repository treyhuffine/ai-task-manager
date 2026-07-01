/**
 * The notifier's subject id. Single-user/local-first → `'local'` (matches the app's `userId`
 * convention on executions/triggers/etc.). The env override is the multi-user seam — when auth
 * lands, derive this from the authenticated session instead (spec §2.13).
 */
export function getNotifierUserId(): string {
  return process.env.NOTIFIER_USER_ID ?? 'local';
}
