/**
 * The HubSpot connector — OAuth2 CRM. Contacts, companies, deals via the CRM v3 API.
 * Per-action scope gating is left off (HubSpot scopes are configured on the app + requested at
 * connect); the engine's scope machinery is proven by Google/Slack.
 */
import { z } from 'zod';
import type { Registry } from '../../core/registry';
import { oauth2 } from '../../auth/oauth2';
import { defineProvider, defineToolkit, httpAction } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export interface HubspotProviderOptions {
  fetch?: typeof fetch;
}

export function hubspot(options: HubspotProviderOptions = {}): Provider {
  return defineProvider({
    id: 'hubspot',
    displayName: 'HubSpot',
    baseUrl: 'https://api.hubapi.com',
    identityScopes: [],
    auth: oauth2({
      authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
      tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
      usePkce: false,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    async identify(http: AuthedHttp) {
      const info = await http.get<{ portalId?: number }>('/account-info/v3/details');
      if (!info.portalId) throw new Error('hubspot identify: no portalId');
      return { accountId: String(info.portalId), label: `HubSpot portal ${info.portalId}` };
    },
  });
}

function obj(name: string, path = `/crm/v3/objects/${name}`) {
  return path;
}

function listAction(object: 'contacts' | 'companies' | 'deals') {
  return httpAction({
    id: `hubspot.list_${object}`,
    description: `List ${object}.`,
    input: z.object({ limit: z.number().int().positive().max(100).default(20), after: z.string().optional() }),
    request: (i) => ({ method: 'GET', path: obj(object), query: { limit: i.limit, after: i.after } }),
    output: (raw) => {
      const r = raw as { results?: unknown[]; paging?: { next?: { after?: string } } };
      return { results: r.results ?? [], next: r.paging?.next?.after };
    },
  });
}

export const hubspotToolkit = defineToolkit({
  id: 'hubspot',
  providerId: 'hubspot',
  displayName: 'HubSpot',
  actions: [
    listAction('contacts'),
    listAction('companies'),
    listAction('deals'),
    httpAction({
      id: 'hubspot.get_contact',
      description: 'Get a contact by id.',
      input: z.object({ contactId: z.string(), properties: z.array(z.string()).optional() }),
      request: (i) => ({ method: 'GET', path: `/crm/v3/objects/contacts/${encodeURIComponent(i.contactId)}`, query: { properties: i.properties?.join(',') } }),
      output: (raw) => raw,
    }),
    httpAction({
      id: 'hubspot.create_contact',
      description: 'Create a contact from a properties map (e.g. { email, firstname, lastname }).',
      mutating: true,
      risk: 'medium',
      input: z.object({ properties: z.record(z.unknown()) }),
      request: (i) => ({ method: 'POST', path: '/crm/v3/objects/contacts', body: { properties: i.properties } }),
      output: (raw) => raw,
    }),
    httpAction({
      id: 'hubspot.update_contact',
      description: 'Update a contact’s properties.',
      mutating: true,
      risk: 'medium',
      input: z.object({ contactId: z.string(), properties: z.record(z.unknown()) }),
      request: (i) => ({ method: 'PATCH', path: `/crm/v3/objects/contacts/${encodeURIComponent(i.contactId)}`, body: { properties: i.properties } }),
      output: (raw) => raw,
    }),
    httpAction({
      id: 'hubspot.search_contacts',
      description: 'Search contacts with a query string and/or filter groups.',
      input: z.object({ query: z.string().optional(), filterGroups: z.array(z.any()).optional(), limit: z.number().int().positive().max(100).default(20) }),
      request: (i) => ({ method: 'POST', path: '/crm/v3/objects/contacts/search', body: { query: i.query, filterGroups: i.filterGroups, limit: i.limit } }),
      output: (raw) => {
        const r = raw as { results?: unknown[]; total?: number };
        return { results: r.results ?? [], total: r.total ?? 0 };
      },
    }),
  ],
});

/** Register the HubSpot provider + toolkit. */
export function registerHubspot(registry: Registry, options: HubspotProviderOptions = {}): void {
  registry.addBundle({ provider: hubspot(options), toolkits: [hubspotToolkit] });
}
