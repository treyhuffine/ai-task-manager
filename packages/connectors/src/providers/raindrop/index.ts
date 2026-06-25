/**
 * The Raindrop.io connector — OAuth2 bookmarks manager. Token grants account access (no granular
 * scopes), so actions carry none.
 */
import { z } from 'zod';
import type { Registry } from '../../core/registry';
import { oauth2 } from '../../auth/oauth2';
import { defineProvider, defineToolkit, httpAction } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export interface RaindropProviderOptions {
  fetch?: typeof fetch;
}

interface UserResponse {
  user?: { _id?: number; email?: string; fullName?: string };
}

export function raindrop(options: RaindropProviderOptions = {}): Provider {
  return defineProvider({
    id: 'raindrop',
    displayName: 'Raindrop',
    baseUrl: 'https://api.raindrop.io/rest/v1',
    identityScopes: [],
    auth: oauth2({
      authorizationUrl: 'https://raindrop.io/oauth/authorize',
      tokenUrl: 'https://raindrop.io/oauth/access_token',
      usePkce: false,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    async identify(http: AuthedHttp) {
      const me = await http.get<UserResponse>('/user');
      const u = me.user;
      if (!u?._id) throw new Error('raindrop identify: no user id');
      return { accountId: String(u._id), ...(u.email !== undefined ? { email: u.email } : {}), label: u.fullName ?? u.email ?? String(u._id) };
    },
  });
}

export const raindropToolkit = defineToolkit({
  id: 'raindrop',
  providerId: 'raindrop',
  displayName: 'Raindrop',
  actions: [
    httpAction({
      id: 'raindrop.list_collections',
      description: 'List the user’s root collections.',
      input: z.object({}),
      request: () => ({ method: 'GET', path: '/collections' }),
      output: (raw) => ({ items: (raw as { items?: unknown[] }).items ?? [] }),
    }),
    httpAction({
      id: 'raindrop.list_raindrops',
      description: 'List bookmarks in a collection (0 = all). Supports search + pagination.',
      input: z.object({
        collectionId: z.number().int().default(0),
        search: z.string().optional(),
        page: z.number().int().min(0).default(0),
        perpage: z.number().int().positive().max(50).default(25),
      }),
      request: (i) => ({
        method: 'GET',
        path: `/raindrops/${i.collectionId}`,
        query: { search: i.search, page: i.page, perpage: i.perpage },
      }),
      output: (raw) => {
        const r = raw as { items?: unknown[]; count?: number };
        return { items: r.items ?? [], count: r.count ?? 0 };
      },
    }),
    httpAction({
      id: 'raindrop.create_raindrop',
      description: 'Create a bookmark (raindrop).',
      mutating: true,
      risk: 'low',
      input: z.object({ link: z.string(), title: z.string().optional(), collectionId: z.number().int().optional(), tags: z.array(z.string()).optional() }),
      request: (i) => ({
        method: 'POST',
        path: '/raindrop',
        body: { link: i.link, title: i.title, tags: i.tags, ...(i.collectionId !== undefined ? { collection: { $id: i.collectionId } } : {}) },
      }),
      output: (raw) => (raw as { item?: unknown }).item ?? raw,
    }),
    httpAction({
      id: 'raindrop.update_raindrop',
      description: 'Update a bookmark by id.',
      mutating: true,
      risk: 'low',
      input: z.object({ id: z.number().int(), title: z.string().optional(), tags: z.array(z.string()).optional(), important: z.boolean().optional() }),
      request: (i) => ({ method: 'PUT', path: `/raindrop/${i.id}`, body: { title: i.title, tags: i.tags, important: i.important } }),
      output: (raw) => (raw as { item?: unknown }).item ?? raw,
    }),
  ],
});

/** Register the Raindrop provider + toolkit. */
export function registerRaindrop(registry: Registry, options: RaindropProviderOptions = {}): void {
  registry.addBundle({ provider: raindrop(options), toolkits: [raindropToolkit] });
}
