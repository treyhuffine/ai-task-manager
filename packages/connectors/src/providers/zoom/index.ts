/**
 * The Zoom connector — OAuth2 (token endpoint uses HTTP Basic client auth). Meetings + cloud
 * recordings via the Zoom API v2. Zoom scopes are configured on the OAuth app; per-action gating
 * is left off here (the engine's scope machinery is proven by Google/Slack).
 */
import { z } from 'zod';
import type { Registry } from '../../core/registry';
import { oauth2 } from '../../auth/oauth2';
import { defineProvider, defineToolkit, httpAction } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export interface ZoomProviderOptions {
  fetch?: typeof fetch;
}

interface MeResponse {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
}

export function zoom(options: ZoomProviderOptions = {}): Provider {
  return defineProvider({
    id: 'zoom',
    displayName: 'Zoom',
    baseUrl: 'https://api.zoom.us/v2',
    identityScopes: [],
    auth: oauth2({
      authorizationUrl: 'https://zoom.us/oauth/authorize',
      tokenUrl: 'https://zoom.us/oauth/token',
      tokenAuthMethod: 'client_secret_basic',
      usePkce: false,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    async identify(http: AuthedHttp) {
      const me = await http.get<MeResponse>('/users/me');
      if (!me.id) throw new Error('zoom identify: /users/me returned no id');
      return {
        accountId: me.id,
        ...(me.email !== undefined ? { email: me.email } : {}),
        label: [me.first_name, me.last_name].filter(Boolean).join(' ') || me.email || me.id,
      };
    },
  });
}

export const zoomToolkit = defineToolkit({
  id: 'zoom',
  providerId: 'zoom',
  displayName: 'Zoom',
  actions: [
    httpAction({
      id: 'zoom.list_meetings',
      description: 'List the current user’s meetings.',
      input: z.object({ type: z.enum(['scheduled', 'live', 'upcoming']).default('upcoming'), page_size: z.number().int().positive().max(300).default(30) }),
      request: (i) => ({ method: 'GET', path: '/users/me/meetings', query: { type: i.type, page_size: i.page_size } }),
      output: (raw) => {
        const r = raw as { meetings?: unknown[]; total_records?: number };
        return { meetings: r.meetings ?? [], total: r.total_records ?? 0 };
      },
    }),
    httpAction({
      id: 'zoom.create_meeting',
      description: 'Schedule a meeting for the current user.',
      mutating: true,
      risk: 'medium',
      input: z.object({
        topic: z.string(),
        start_time: z.string().optional().describe('ISO 8601 start time'),
        duration: z.number().int().positive().optional().describe('minutes'),
        timezone: z.string().optional(),
        agenda: z.string().optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/users/me/meetings',
        body: { topic: i.topic, type: 2, start_time: i.start_time, duration: i.duration, timezone: i.timezone, agenda: i.agenda },
      }),
      output: (raw) => {
        const r = raw as { id?: number; join_url?: string; start_url?: string };
        return { id: r.id, join_url: r.join_url, start_url: r.start_url };
      },
    }),
    httpAction({
      id: 'zoom.get_meeting',
      description: 'Get a meeting by id.',
      input: z.object({ meetingId: z.string() }),
      request: (i) => ({ method: 'GET', path: `/meetings/${encodeURIComponent(i.meetingId)}` }),
      output: (raw) => raw,
    }),
    httpAction({
      id: 'zoom.update_meeting',
      description: 'Update a meeting’s fields.',
      mutating: true,
      risk: 'medium',
      input: z.object({ meetingId: z.string(), topic: z.string().optional(), start_time: z.string().optional(), duration: z.number().int().positive().optional(), agenda: z.string().optional() }),
      request: (i) => ({
        method: 'PATCH',
        path: `/meetings/${encodeURIComponent(i.meetingId)}`,
        body: { topic: i.topic, start_time: i.start_time, duration: i.duration, agenda: i.agenda },
      }),
      output: () => ({ updated: true }),
    }),
    httpAction({
      id: 'zoom.delete_meeting',
      description: 'Delete a meeting by id.',
      mutating: true,
      risk: 'high',
      input: z.object({ meetingId: z.string() }),
      request: (i) => ({ method: 'DELETE', path: `/meetings/${encodeURIComponent(i.meetingId)}` }),
      output: () => ({ deleted: true }),
    }),
    httpAction({
      id: 'zoom.list_recordings',
      description: 'List the current user’s cloud recordings.',
      input: z.object({ from: z.string().optional().describe('YYYY-MM-DD'), to: z.string().optional(), page_size: z.number().int().positive().max(300).default(30) }),
      request: (i) => ({ method: 'GET', path: '/users/me/recordings', query: { from: i.from, to: i.to, page_size: i.page_size } }),
      output: (raw) => ({ meetings: (raw as { meetings?: unknown[] }).meetings ?? [] }),
    }),
  ],
});

/** Register the Zoom provider + toolkit. */
export function registerZoom(registry: Registry, options: ZoomProviderOptions = {}): void {
  registry.addBundle({ provider: zoom(options), toolkits: [zoomToolkit] });
}
