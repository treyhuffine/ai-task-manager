/**
 * The QuickBooks Online (Intuit) provider. OAuth2 with `client_secret_basic` at the token
 * endpoint. Like Jira there is NO fixed `baseUrl`: the Accounting API is per-company, addressed
 * as `https://quickbooks.api.intuit.com/v3/company/{realmId}`. Unlike Jira, the `realmId` is
 * returned on the OAuth *callback* as a query param rather than from an API call — so `identify()`
 * reads it from the callback params (`ctx.params.realmId`) and stashes it as the connection's
 * config. Actions read `ctx.config.realmId` (never an action input).
 */
import { oauth2 } from '../../auth/oauth2';
import { defineProvider } from '../../core/authoring';
import type { IdentifyContext, Provider } from '../../core/types';

export interface QuickbooksProviderOptions {
  /** Injectable fetch for the token/API endpoints (tests). */
  fetch?: typeof fetch;
}

export function quickbooks(options: QuickbooksProviderOptions = {}): Provider {
  return defineProvider({
    id: 'quickbooks',
    displayName: 'QuickBooks',
    // No baseUrl — the API base is per-company (built from a realmId in each action).
    // `offline_access` guarantees a refresh token; `openid` identifies the Intuit user.
    identityScopes: ['openid', 'offline_access'],
    revokeUrl: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
    auth: oauth2({
      authorizationUrl: 'https://appcenter.intuit.com/connect/oauth2',
      tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      usePkce: false,
      tokenAuthMethod: 'client_secret_basic',
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    // The realmId (company id) arrives on the OAuth callback, not from an API call: read it from
    // the callback params and bind it to the connection so actions never carry it as input.
    // eslint-disable-next-line @typescript-eslint/require-await
    async identify(_http, ctx: IdentifyContext) {
      const realmId = ctx.params?.realmId;
      if (!realmId) {
        throw new Error('quickbooks identify: missing realmId callback param (Intuit returns it on the redirect)');
      }
      return { accountId: realmId, label: `QuickBooks company ${realmId}`, config: { realmId } };
    },
    // identify needs a connect-time callback param it can't have at probe time, so declare an
    // explicit health check: a real read of the company info against the stored realmId.
    async healthCheck(http, { config }) {
      const realmId = String(config.realmId);
      await http.get(`https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`, {
        headers: { Accept: 'application/json' },
      });
    },
  });
}
