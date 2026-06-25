/**
 * The Linear auth provider — OAuth2 over Linear's GraphQL API. One consent backs the single
 * `linear` toolkit (all calls are POST /graphql). Identity comes from the GraphQL `viewer`.
 */
import { oauth2 } from '../../auth/oauth2';
import { defineProvider } from '../../core/authoring';
import { ConnectorError } from '../../core/errors';
import type { AuthedHttp, Provider } from '../../core/types';

export interface LinearProviderOptions {
  /** Injectable fetch for the token/revoke endpoints (tests). */
  fetch?: typeof fetch;
}

interface ViewerResp {
  data?: { viewer?: { id?: string; name?: string; email?: string } };
  errors?: Array<{ message?: string }>;
}

const LINEAR_REVOKE_URL = 'https://api.linear.app/oauth/revoke';

export function linear(options: LinearProviderOptions = {}): Provider {
  return defineProvider({
    id: 'linear',
    displayName: 'Linear',
    baseUrl: 'https://api.linear.app',
    identityScopes: [],
    revokeUrl: LINEAR_REVOKE_URL,
    auth: oauth2({
      authorizationUrl: 'https://linear.app/oauth/authorize',
      tokenUrl: 'https://api.linear.app/oauth/token',
      usePkce: false,
      revokeUrl: LINEAR_REVOKE_URL,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    async identify(http: AuthedHttp) {
      const res = await http.post<ViewerResp>('/graphql', { query: '{ viewer { id name email } }' });
      if (res.errors?.length) throw new ConnectorError('provider_error', `linear: ${res.errors[0]?.message ?? 'graphql error'}`);
      const v = res.data?.viewer;
      if (!v?.id) throw new Error('linear identify: viewer returned no id');
      return {
        accountId: v.id,
        ...(v.email !== undefined ? { email: v.email } : {}),
        label: v.name ?? v.email ?? v.id,
      };
    },
  });
}
