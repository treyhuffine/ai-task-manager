import type { AuthConfig, AuthConfigStore } from '@integrations/engine';

/**
 * A saved OAuth app (one you added in Integrations) is stored with the callback
 * address Ri had when you added it. That address goes stale the moment Ri's
 * address changes: a tunnel renamed (flow-trey to ri-trey), a remote address
 * set or cleared. Sign-ins kept sending the provider the old address, while
 * Integrations settings showed the current one, so the mismatch was invisible.
 *
 * So the stored address is never trusted for Ri's own callback paths: every
 * read of a saved app rebases it onto Ri's current origin, keeping the path.
 * Every sign-in path (connect, re-consent, a sign-in link an agent hands
 * out) then uses the address Ri is reachable at now, which is the one
 * Integrations settings shows and the one to register with the provider.
 * The current origin follows Ri's address in Devices (see
 * `getIntegrationRedirectUri`). A callback outside Ri's own paths (a desktop
 * relay, an operator's own proxy) is left exactly as stored.
 */

/** The callback paths Ri serves: the shared OAuth callback and the MCP sign-in callbacks. */
const RI_CALLBACK_PATHS = [/^\/api\/integrations\/callback\/?$/, /^\/api\/integrations\/mcp-oauth\/[^/]+\/?$/];

/** `uri` moved onto `origin` when it is one of Ri's callback paths, else unchanged. */
export function rebaseCallback(uri: string, origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return uri;
  }
  if (!RI_CALLBACK_PATHS.some((re) => re.test(parsed.pathname))) return uri;
  return new URL(`${parsed.pathname}${parsed.search}`, origin).href;
}

function withRebasedCallback(config: AuthConfig, origin: string): AuthConfig {
  const redirectUri = config.oauth?.redirectUri;
  if (!config.oauth || !redirectUri) return config;
  const rebased = rebaseCallback(redirectUri, origin);
  return rebased === redirectUri ? config : { ...config, oauth: { ...config.oauth, redirectUri: rebased } };
}

/**
 * The saved-app store, with Ri's callback paths rebased onto `currentOrigin()`
 * on every read. Writes pass through untouched. `currentOrigin` is read at
 * call time, so a changed address applies to the next sign-in without a
 * runtime rebuild.
 */
export function withLiveCallback(store: AuthConfigStore, currentOrigin: () => string): AuthConfigStore {
  return {
    ...store,
    async get(id) {
      const entry = await store.get(id);
      return entry ? { ...entry, config: withRebasedCallback(entry.config, currentOrigin()) } : null;
    },
    async listForProvider(providerId) {
      const origin = currentOrigin();
      return (await store.listForProvider(providerId)).map((config) => withRebasedCallback(config, origin));
    },
  };
}
