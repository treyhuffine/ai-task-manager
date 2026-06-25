/**
 * The Salesforce connector — OAuth2. Salesforce is per-instance: the OAuth token response carries
 * an `instance_url` that all API calls must target. `resolveBaseUrl` captures it at connect as the
 * connection's baseUrl, so `identify()` and every action use RELATIVE paths (resolved against the
 * org's instance) — the agent never carries an instance URL.
 */
import { z } from 'zod';
import type { Registry } from '../../core/registry';
import { oauth2 } from '../../auth/oauth2';
import { defineProvider, defineToolkit, httpAction } from '../../core/authoring';
import type { AuthedHttp, IdentifyContext, Provider } from '../../core/types';

export interface SalesforceProviderOptions {
  fetch?: typeof fetch;
  /** Override the login host (use https://test.salesforce.com for sandboxes). */
  loginUrl?: string;
}

const API_VERSION = 'v59.0';

/** Relative Data API path — resolved against the connection's instance_url baseUrl. */
function dataPath(suffix: string): string {
  return `/services/data/${API_VERSION}/${suffix.replace(/^\/+/, '')}`;
}

export function salesforce(options: SalesforceProviderOptions = {}): Provider {
  const login = options.loginUrl ?? 'https://login.salesforce.com';
  return defineProvider({
    id: 'salesforce',
    displayName: 'Salesforce',
    baseUrl: login, // fallback only; the per-connection instance_url overrides via resolveBaseUrl
    identityScopes: [],
    auth: oauth2({
      authorizationUrl: `${login}/services/oauth2/authorize`,
      tokenUrl: `${login}/services/oauth2/token`,
      usePkce: true,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    // The org's API base IS the token response's instance_url — capture it as the connection base.
    resolveBaseUrl: (ctx: IdentifyContext) => (ctx.tokenResponse as { instance_url?: string })?.instance_url,
    // identify() now runs against the instance host (set above), so it can read the user info.
    async identify(http: AuthedHttp) {
      const me = await http.get<{ user_id?: string; sub?: string; email?: string; name?: string }>(
        '/services/oauth2/userinfo',
      );
      return {
        accountId: me.user_id ?? me.sub ?? 'salesforce:user',
        ...(me.email !== undefined ? { email: me.email } : {}),
        ...(me.name !== undefined ? { label: me.name } : {}),
      };
    },
  });
}

export const salesforceToolkit = defineToolkit({
  id: 'salesforce',
  providerId: 'salesforce',
  displayName: 'Salesforce',
  actions: [
    httpAction({
      id: 'salesforce.soql_query',
      description: 'Run a SOQL query.',
      input: z.object({ soql: z.string() }),
      request: (i) => ({ method: 'GET', path: dataPath('query'), query: { q: i.soql } }),
      output: (raw) => {
        const r = raw as { totalSize?: number; records?: unknown[]; done?: boolean };
        return { totalSize: r.totalSize ?? 0, records: r.records ?? [], done: r.done ?? true };
      },
    }),
    httpAction({
      id: 'salesforce.get_record',
      description: 'Get an sObject record by id.',
      input: z.object({ sobject: z.string(), id: z.string(), fields: z.array(z.string()).optional() }),
      request: (i) => ({
        method: 'GET',
        path: dataPath(`sobjects/${encodeURIComponent(i.sobject)}/${encodeURIComponent(i.id)}`),
        query: { fields: i.fields?.join(',') },
      }),
      output: (raw) => raw,
    }),
    httpAction({
      id: 'salesforce.create_record',
      description: 'Create an sObject record from a fields map.',
      mutating: true,
      risk: 'medium',
      input: z.object({ sobject: z.string(), fields: z.record(z.unknown()) }),
      request: (i) => ({ method: 'POST', path: dataPath(`sobjects/${encodeURIComponent(i.sobject)}`), body: i.fields }),
      output: (raw) => raw,
    }),
    httpAction({
      id: 'salesforce.update_record',
      description: 'Update an sObject record (partial).',
      mutating: true,
      risk: 'medium',
      input: z.object({ sobject: z.string(), id: z.string(), fields: z.record(z.unknown()) }),
      request: (i) => ({
        method: 'PATCH',
        path: dataPath(`sobjects/${encodeURIComponent(i.sobject)}/${encodeURIComponent(i.id)}`),
        body: i.fields,
      }),
      output: () => ({ updated: true }),
    }),
    httpAction({
      id: 'salesforce.delete_record',
      description: 'Delete an sObject record by id.',
      mutating: true,
      risk: 'high',
      input: z.object({ sobject: z.string(), id: z.string() }),
      request: (i) => ({ method: 'DELETE', path: dataPath(`sobjects/${encodeURIComponent(i.sobject)}/${encodeURIComponent(i.id)}`) }),
      output: () => ({ deleted: true }),
    }),
  ],
});

/** Register the Salesforce provider + toolkit. */
export function registerSalesforce(registry: Registry, options: SalesforceProviderOptions = {}): void {
  registry.addBundle({ provider: salesforce(options), toolkits: [salesforceToolkit] });
}
