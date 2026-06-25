/**
 * The Confluence (Atlassian Cloud) provider. OAuth2 3LO through auth.atlassian.com — the same
 * auth boundary as Jira. Like Jira there is NO fixed `baseUrl`: the API is per-site, addressed
 * as `https://api.atlassian.com/ex/confluence/{cloudId}/wiki`, where `cloudId` comes from the
 * accessible-resources endpoint. `identify()` records that cloudId as the accountId; toolkit
 * actions take it as an input and build absolute URLs (see toolkit.ts).
 */
import { oauth2 } from '../../auth/oauth2';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export interface ConfluenceProviderOptions {
  /** Injectable fetch for the token/API endpoints (tests). */
  fetch?: typeof fetch;
}

interface AccessibleResource {
  id: string;
  name?: string;
  url?: string;
}

export function confluence(options: ConfluenceProviderOptions = {}): Provider {
  return defineProvider({
    id: 'confluence',
    displayName: 'Confluence',
    // No baseUrl — the API base is per-site (built from a cloudId in each action).
    // `offline_access` guarantees a refresh token; `read:me` lets us read the account.
    identityScopes: ['offline_access', 'read:me'],
    auth: oauth2({
      authorizationUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      usePkce: false,
      authParams: { audience: 'api.atlassian.com', prompt: 'consent' },
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    async identify(http: AuthedHttp) {
      // The cloudId IS the accountId: a token can span multiple sites; we bind to the first.
      const resources = await http.get<AccessibleResource[]>(
        'https://api.atlassian.com/oauth/token/accessible-resources',
      );
      const first = resources?.[0];
      if (!first) throw new Error('confluence identify: token has no accessible Atlassian sites');
      // Stash cloudId on the connection so actions build the per-site URL without an input.
      return { accountId: first.id, label: first.name ?? first.id, config: { cloudId: first.id } };
    },
  });
}
