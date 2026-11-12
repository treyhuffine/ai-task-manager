import { describe, expect, it } from 'vitest';
import * as q from '@/lib/db/queries';
import { HUB_ACCESS_TTL_MS, isHubToken, issueHubTokens, refreshHubTokens, revokeHubTokenValue, verifyHubAccessToken } from './tokens';

/** App tokens for the hub: they expire, refresh once each, and stop when the app is turned off. */
function app(clientId = `client-${crypto.randomUUID()}`) {
  return q.upsertHubApp({ clientId, name: 'Bloom', grant: { accounts: [], services: ['list_tasks'] } });
}

describe('hub tokens', () => {
  it('reach as the app until they expire', () => {
    const bloom = app();
    const now = Date.now();
    const tokens = issueHubTokens(bloom.id, now - HUB_ACCESS_TTL_MS - 1000);
    expect(isHubToken(tokens.access_token)).toBe(true);
    expect(tokens.expires_in).toBe(3600);
    expect(verifyHubAccessToken(tokens.access_token)).toBeNull();
    const fresh = issueHubTokens(bloom.id);
    expect(verifyHubAccessToken(fresh.access_token)?.id).toBe(bloom.id);
    expect(verifyHubAccessToken('ri_hub_at_unknown')).toBeNull();
    expect(verifyHubAccessToken('not-a-hub-token')).toBeNull();
  });

  it('refresh once, for the client they were issued to, and a replay ends every token the app holds', () => {
    const bloom = app();
    const first = issueHubTokens(bloom.id);
    expect(refreshHubTokens(first.refresh_token, 'someone-else')).toMatchObject({ ok: false, error: 'invalid_grant' });
    const second = refreshHubTokens(first.refresh_token, bloom.clientId);
    if (!second.ok) throw new Error(second.description);
    // The old access token went with its refresh token.
    expect(verifyHubAccessToken(first.access_token)).toBeNull();
    expect(verifyHubAccessToken(second.tokens.access_token)?.id).toBe(bloom.id);
    // Presenting the spent refresh token again: only a copy could, so everything stops.
    expect(refreshHubTokens(first.refresh_token, bloom.clientId)).toMatchObject({ ok: false, error: 'invalid_grant' });
    expect(verifyHubAccessToken(second.tokens.access_token)).toBeNull();
    expect(refreshHubTokens(second.tokens.refresh_token, bloom.clientId)).toMatchObject({ ok: false });
  });

  it('stop at the next call when the app is turned off, and can be ended by whoever holds them', () => {
    const bloom = app();
    const tokens = issueHubTokens(bloom.id);
    q.revokeHubApp(bloom.id);
    expect(verifyHubAccessToken(tokens.access_token)).toBeNull();
    expect(refreshHubTokens(tokens.refresh_token, bloom.clientId)).toMatchObject({ ok: false });
    // Connecting again turns it back on with a new grant revision.
    const again = q.upsertHubApp({ clientId: bloom.clientId, name: 'Bloom', grant: { accounts: [], services: [] } });
    expect(again).toMatchObject({ id: bloom.id, revokedAt: null, grantRevision: bloom.grantRevision + 1 });
    const next = issueHubTokens(bloom.id);
    revokeHubTokenValue(next.access_token);
    expect(verifyHubAccessToken(next.access_token)).toBeNull();
  });
});
