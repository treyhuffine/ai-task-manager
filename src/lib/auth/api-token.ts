import { findApiKeyByHash } from '@/lib/db/queries';
import { hashToken } from './tokens';

/** Shared lifetime check for HTTP and WebSocket credentials. */
export function lookupApiToken(token: string) {
  const tokenHash = hashToken(token);
  const key = findApiKeyByHash(tokenHash);
  if (!key || key.revokedAt || (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now())) return null;
  return { key, tokenHash };
}
