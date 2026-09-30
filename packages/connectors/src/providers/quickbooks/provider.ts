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
import { QUICKBOOKS_ACCOUNTING_SCOPE, QUICKBOOKS_JSON_HEADERS, quickbooksBase, quickbooksEntity, quickbooksEnvironment, quickbooksRealm } from './shared';
import type { QuickbooksEnvironment } from './shared';

export interface QuickbooksProviderOptions {
  /** Injectable fetch for the token/API endpoints (tests). */
  fetch?: typeof fetch;
  /** Environment used for NEW authorizations. Existing connections retain their stored environment. */
  environment?: QuickbooksEnvironment;
}

export function quickbooks(options: QuickbooksProviderOptions = {}): Provider {
  const environment = quickbooksEnvironment(options.environment);
  return defineProvider({
    id: 'quickbooks',
    displayName: 'QuickBooks',
    // No baseUrl — the API base is per-company (built from a realmId in each action).
    // Company identity is read from Accounting, not OpenID. Intuit's accounting OAuth grant
    // already includes refresh tokens and does not require an offline_access scope.
    identityScopes: [QUICKBOOKS_ACCOUNTING_SCOPE],
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
    async identify(http, ctx: IdentifyContext) {
      const realmId = quickbooksRealm(ctx.params?.realmId);
      const config = { realmId, environment };
      const company = quickbooksEntity(await http.get(`${quickbooksBase(config)}/companyinfo/${encodeURIComponent(realmId)}`, {
        headers: QUICKBOOKS_JSON_HEADERS,
      }), 'CompanyInfo');
      const name = typeof company.CompanyName === 'string' && company.CompanyName.trim()
        ? company.CompanyName.trim() : `QuickBooks company ${realmId}`;
      return {
        accountId: environment === 'sandbox' ? `sandbox:${realmId}` : realmId,
        label: environment === 'sandbox' ? `${name} (sandbox)` : name,
        config,
      };
    },
    // identify needs a connect-time callback param it can't have at probe time, so declare an
    // explicit health check: a real read of the company info against the stored realmId.
    async healthCheck(http, { config }) {
      const realmId = quickbooksRealm(config.realmId);
      quickbooksEntity(await http.get(`${quickbooksBase(config)}/companyinfo/${encodeURIComponent(realmId)}`, {
        headers: QUICKBOOKS_JSON_HEADERS,
      }), 'CompanyInfo');
    },
  });
}
