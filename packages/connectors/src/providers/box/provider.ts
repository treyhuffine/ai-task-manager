/**
 * The Box provider (Content API 2.0). OAuth2 authorization-code; Box scopes are configured at
 * the app level rather than per-request, so actions declare none. One Box connection per account.
 */
import { oauth2 } from '../../auth/oauth2';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

const BOX_REVOKE_URL = 'https://api.box.com/oauth2/revoke';

export interface BoxProviderOptions {
  /** Injectable fetch for the token/revoke endpoints (tests). */
  fetch?: typeof fetch;
}

export function box(options: BoxProviderOptions = {}): Provider {
  return defineProvider({
    id: 'box',
    displayName: 'Box',
    baseUrl: 'https://api.box.com/2.0',
    identityScopes: [],
    revokeUrl: BOX_REVOKE_URL,
    auth: oauth2({
      authorizationUrl: 'https://account.box.com/api/oauth2/authorize',
      tokenUrl: 'https://api.box.com/oauth2/token',
      revokeUrl: BOX_REVOKE_URL,
      usePkce: false,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    async identify(http: AuthedHttp) {
      const me = await http.get<{ id: string | number; login?: string; name?: string }>('/users/me');
      const accountId = String(me.id);
      return {
        accountId,
        ...(me.login !== undefined ? { email: me.login } : {}),
        label: me.name ?? me.login ?? accountId,
      };
    },
  });
}
