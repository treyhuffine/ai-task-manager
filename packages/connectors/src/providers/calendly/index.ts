/**
 * The Calendly connector — OAuth2. Calendly's API is URI-centric (users/events are URIs).
 * No granular OAuth scopes, so actions carry none; the token grants account access.
 */
import { z } from 'zod';
import type { Registry } from '../../core/registry';
import { oauth2 } from '../../auth/oauth2';
import { defineProvider, defineToolkit, httpAction } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export interface CalendlyProviderOptions {
  fetch?: typeof fetch;
}

interface MeResponse {
  resource?: { uri?: string; name?: string; email?: string };
}

export function calendly(options: CalendlyProviderOptions = {}): Provider {
  return defineProvider({
    id: 'calendly',
    displayName: 'Calendly',
    baseUrl: 'https://api.calendly.com',
    identityScopes: [],
    auth: oauth2({
      authorizationUrl: 'https://auth.calendly.com/oauth/authorize',
      tokenUrl: 'https://auth.calendly.com/oauth/token',
      usePkce: false,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    async identify(http: AuthedHttp) {
      const me = await http.get<MeResponse>('/users/me');
      const r = me.resource;
      if (!r?.uri) throw new Error('calendly identify: no user uri');
      return { accountId: r.uri, ...(r.email !== undefined ? { email: r.email } : {}), label: r.name ?? r.email ?? r.uri };
    },
  });
}

export const calendlyToolkit = defineToolkit({
  id: 'calendly',
  providerId: 'calendly',
  displayName: 'Calendly',
  actions: [
    httpAction({
      id: 'calendly.get_current_user',
      description: 'Get the current Calendly user (uri, name, email, scheduling URL).',
      input: z.object({}),
      request: () => ({ method: 'GET', path: '/users/me' }),
      output: (raw) => (raw as MeResponse).resource ?? {},
    }),
    httpAction({
      id: 'calendly.list_event_types',
      description: 'List a user’s event types. Pass the user URI (from get_current_user).',
      input: z.object({ user: z.string().describe('User URI'), count: z.number().int().positive().max(100).default(25) }),
      request: (i) => ({ method: 'GET', path: '/event_types', query: { user: i.user, count: i.count } }),
      output: (raw) => ({ collection: (raw as { collection?: unknown[] }).collection ?? [] }),
    }),
    httpAction({
      id: 'calendly.list_scheduled_events',
      description: 'List scheduled events for a user URI.',
      input: z.object({
        user: z.string().describe('User URI'),
        status: z.enum(['active', 'canceled']).optional(),
        count: z.number().int().positive().max(100).default(25),
      }),
      request: (i) => ({ method: 'GET', path: '/scheduled_events', query: { user: i.user, status: i.status, count: i.count } }),
      output: (raw) => ({ collection: (raw as { collection?: unknown[] }).collection ?? [] }),
    }),
    httpAction({
      id: 'calendly.get_event',
      description: 'Get a scheduled event by uuid.',
      input: z.object({ uuid: z.string() }),
      request: (i) => ({ method: 'GET', path: `/scheduled_events/${encodeURIComponent(i.uuid)}` }),
      output: (raw) => (raw as { resource?: unknown }).resource ?? raw,
    }),
    httpAction({
      id: 'calendly.cancel_event',
      description: 'Cancel a scheduled event by uuid.',
      mutating: true,
      risk: 'high',
      input: z.object({ uuid: z.string(), reason: z.string().optional() }),
      request: (i) => ({ method: 'POST', path: `/scheduled_events/${encodeURIComponent(i.uuid)}/cancellation`, body: { reason: i.reason } }),
      output: (raw) => (raw as { resource?: unknown }).resource ?? raw,
    }),
  ],
});

/** Register the Calendly provider + toolkit. */
export function registerCalendly(registry: Registry, options: CalendlyProviderOptions = {}): void {
  registry.addBundle({ provider: calendly(options), toolkits: [calendlyToolkit] });
}
