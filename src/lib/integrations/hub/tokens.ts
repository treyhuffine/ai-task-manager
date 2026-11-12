/**
 * App tokens for the hub (docs/personal-apps.md "The hub"). An app's access token reaches only
 * Ri's integrations endpoint, sees only its grant, and expires in an hour. Its refresh token
 * lasts 30 days, is used once, and a refresh token presented again revokes every token the app
 * holds (RFC 9700 §4.14.2), since only a copy could present it twice. Turning an app off revokes
 * them all. Tokens are stored hashed.
 */
import crypto from 'node:crypto';
import {
  hubTokenForAccess, hubTokenForRefresh, insertHubToken, revokeHubToken, revokeHubTokensForApp,
  spendHubRefreshToken, touchHubApp, type HubAppRecord,
} from '@/lib/db/queries';

export const HUB_TOKEN_PREFIX = 'ri_hub_';
export const HUB_ACCESS_TTL_MS = 60 * 60_000;
export const HUB_REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const mint = (kind: 'at' | 'rt') => `${HUB_TOKEN_PREFIX}${kind}_${crypto.randomBytes(32).toString('base64url')}`;

export function isHubToken(token: string): boolean {
  return token.startsWith(HUB_TOKEN_PREFIX);
}

export interface HubTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope?: string;
}

/** A fresh access and refresh token for an app whose access is on. */
export function issueHubTokens(appId: string, now = Date.now()): HubTokenResponse {
  const access = mint('at'), refresh = mint('rt');
  insertHubToken({
    appId,
    accessHash: hash(access), accessExpiresAt: new Date(now + HUB_ACCESS_TTL_MS).toISOString(),
    refreshHash: hash(refresh), refreshExpiresAt: new Date(now + HUB_REFRESH_TTL_MS).toISOString(),
  });
  return { access_token: access, token_type: 'Bearer', expires_in: Math.floor(HUB_ACCESS_TTL_MS / 1000), refresh_token: refresh };
}

/** The app an access token speaks for, if the token is live and the app's access is on. */
export function verifyHubAccessToken(token: string): HubAppRecord | null {
  if (!isHubToken(token)) return null;
  const found = hubTokenForAccess(hash(token));
  if (!found) return null;
  touchHubApp(found.app.id);
  return found.app;
}

export type RefreshResult =
  | { ok: true; tokens: HubTokenResponse }
  | { ok: false; error: 'invalid_grant'; description: string };

/** RFC 6749 §6, with rotation: the old refresh token is spent, and a replay ends the app's tokens. */
export function refreshHubTokens(refreshToken: string, clientId: string, now = Date.now()): RefreshResult {
  const found = isHubToken(refreshToken) ? hubTokenForRefresh(hash(refreshToken)) : null;
  if (!found || found.app.clientId !== clientId) return { ok: false, error: 'invalid_grant', description: 'This refresh token is unknown. Connect to Ri again.' };
  if (found.app.revokedAt) return { ok: false, error: 'invalid_grant', description: 'This app’s access to Ri was turned off. Connect to Ri again.' };
  const replay = () => {
    revokeHubTokensForApp(found.app.id);
    return { ok: false as const, error: 'invalid_grant' as const, description: 'This refresh token was already used, so every token for this app was ended. Connect to Ri again.' };
  };
  // Spent already: only a copy could present it again.
  if (found.token.refreshedAt) return replay();
  if (found.token.revokedAt || found.token.refreshExpiresAt <= new Date(now).toISOString()) {
    return { ok: false, error: 'invalid_grant', description: 'This refresh token has expired. Connect to Ri again.' };
  }
  if (!spendHubRefreshToken(found.token.id)) return replay();
  revokeHubToken(found.token.id);
  return { ok: true, tokens: issueHubTokens(found.app.id, now) };
}

/** RFC 7009: holding a token is the authority to end it. Unknown tokens succeed too. */
export function revokeHubTokenValue(token: string): void {
  if (!isHubToken(token)) return;
  const access = hubTokenForAccess(hash(token));
  if (access) { revokeHubToken(access.token.id); return; }
  const refresh = hubTokenForRefresh(hash(token));
  if (refresh) revokeHubToken(refresh.token.id);
}
