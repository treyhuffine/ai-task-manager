import { expect, it } from 'vitest';
import { makeMcpOAuthProvider, type McpOAuthState } from '../src/lib/integrations/mcp-oauth';

it('persists unpredictable state and PKCE, restores the callback, and clears consumed secrets', async () => {
  let saved: McpOAuthState = {};
  let revision = 0;
  const persistence = { load: async () => structuredClone(saved), compareAndSave: async (expected: string | undefined, s: McpOAuthState) => {
    if (saved.revision !== expected) return null;
    saved = structuredClone({ ...s, revision: String(++revision) });
    return structuredClone(saved);
  } };
  const callback = 'http://127.0.0.1:12345/oauth/callback';
  const provider = makeMcpOAuthProvider({ ...persistence, clientName: 'Ri', redirectUrl: callback, interactive: true });
  const state = await provider.state!();
  expect(state.length).toBeGreaterThanOrEqual(32);
  expect(saved.authorizationState).toBe(state);
  expect(saved.authorizationExpiresAt).toBeGreaterThan(Date.now());
  await provider.saveCodeVerifier('verifier');
  await provider.saveClientInformation!({ client_id: 'registered' });
  // The callback atomically consumes browser state before the code exchange.
  delete saved.authorizationState;
  delete saved.authorizationExpiresAt;
  saved.revision = String(++revision);
  const callbackProvider = makeMcpOAuthProvider({ ...persistence, clientName: 'Ri', redirectUrl: 'https://web.example/api/callback' });
  await callbackProvider.clientInformation();
  expect(callbackProvider.redirectUrl).toBe(callback);
  expect(await callbackProvider.codeVerifier()).toBe('verifier');
  await callbackProvider.saveTokens({ access_token: 'access', token_type: 'Bearer' });
  expect(saved.authorizationState).toBeUndefined();
  expect(saved.codeVerifier).toBeUndefined();
  expect(saved.tokens?.access_token).toBe('access');
  const retry = makeMcpOAuthProvider({ ...persistence, clientName: 'Ri', redirectUrl: 'http://127.0.0.1:12346/oauth/callback', interactive: true });
  expect(await retry.tokens()).toBeUndefined();
  expect(await retry.clientInformation()).toBeUndefined();
});
