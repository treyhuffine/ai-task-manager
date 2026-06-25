/**
 * The Notion auth provider. OAuth2 with a Basic-auth token endpoint (Notion requires
 * `client_secret_basic`). Notion has no granular OAuth scopes — access is workspace-level —
 * so `identityScopes` is empty and actions are not scope-gated. Every request must carry the
 * `Notion-Version` header.
 */
import { oauth2 } from '../../auth/oauth2';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export interface NotionProviderOptions {
  /** Injectable fetch for the token endpoint + API (tests). */
  fetch?: typeof fetch;
}

/** Pinned Notion API version, sent on every request. */
export const NOTION_VERSION = '2022-06-28';

interface NotionUser {
  id?: string;
  name?: string;
}

export function notion(options: NotionProviderOptions = {}): Provider {
  return defineProvider({
    id: 'notion',
    displayName: 'Notion',
    baseUrl: 'https://api.notion.com/v1',
    identityScopes: [],
    auth: oauth2({
      authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
      tokenUrl: 'https://api.notion.com/v1/oauth/token',
      usePkce: false,
      // Notion authenticates the token request with HTTP Basic (client_id:client_secret).
      tokenAuthMethod: 'client_secret_basic',
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    async identify(http: AuthedHttp) {
      const me = await http.get<NotionUser>('/users/me', { headers: { 'Notion-Version': NOTION_VERSION } });
      const accountId = me.id ?? 'notion';
      return { accountId, ...(me.name ? { label: me.name } : {}) };
    },
  });
}
