/**
 * The `confluence` toolkit. The site (`cloudId`) is captured on the connection at connect (see
 * provider.ts identify) and read from `ctx.config` in each action's `request(input, { config })`
 * — never an action input. Each action builds an ABSOLUTE Confluence Cloud URL; search uses the
 * v1 CQL endpoint, page read/create use the v2 API with `storage` (HTML-ish) body format.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

const SCOPE = { read: 'read:confluence-content.all', write: 'write:confluence-content' } as const;

/** Per-site Confluence Cloud base, from the connection's stored cloudId. */
function base(config: Record<string, unknown>): string {
  return `https://api.atlassian.com/ex/confluence/${encodeURIComponent(String(config.cloudId))}/wiki`;
}

export const confluenceToolkit = defineToolkit({
  id: 'confluence',
  providerId: 'confluence',
  displayName: 'Confluence',
  actions: [
    httpAction({
      id: 'confluence.search_pages',
      description: 'Search Confluence content with a CQL query.',
      scopes: [SCOPE.read],
      input: z.object({
        cql: z.string().describe('CQL, e.g. text ~ "roadmap" AND type = page'),
        limit: z.number().int().positive().max(100).default(25),
      }),
      request: (i, { config }) => ({
        method: 'GET',
        path: `${base(config)}/rest/api/search`,
        query: { cql: i.cql, limit: i.limit },
      }),
      output: (raw) => {
        const r = raw as { results?: Array<{ content?: { id?: string; title?: string; type?: string }; title?: string }> };
        return {
          results: (r.results ?? []).map((hit) => ({
            id: hit.content?.id,
            title: hit.content?.title ?? hit.title,
            type: hit.content?.type,
          })),
        };
      },
    }),

    httpAction({
      id: 'confluence.get_page',
      description: 'Get a Confluence page by id, including its storage-format body.',
      scopes: [SCOPE.read],
      input: z.object({ id: z.string() }),
      request: (i, { config }) => ({
        method: 'GET',
        path: `${base(config)}/api/v2/pages/${encodeURIComponent(i.id)}`,
        query: { 'body-format': 'storage' },
      }),
      output: (raw) => {
        const r = raw as { id?: string; title?: string; spaceId?: string; body?: { storage?: { value?: string } } };
        return { id: r.id, title: r.title, spaceId: r.spaceId, body: r.body?.storage?.value };
      },
    }),

    httpAction({
      id: 'confluence.create_page',
      description: 'Create a Confluence page in a space (storage-format body).',
      mutating: true,
      risk: 'medium',
      scopes: [SCOPE.write],
      input: z.object({
        spaceId: z.string(),
        title: z.string(),
        value: z.string().describe('Storage-format (HTML-ish) page body'),
      }),
      request: (i, { config }) => ({
        method: 'POST',
        path: `${base(config)}/api/v2/pages`,
        body: { spaceId: i.spaceId, status: 'current', title: i.title, body: { representation: 'storage', value: i.value } },
      }),
      output: (raw) => {
        const r = raw as { id?: string; title?: string };
        return { id: r.id, title: r.title };
      },
    }),

    httpAction({
      id: 'confluence.list_spaces',
      description: 'List Confluence spaces on the site.',
      scopes: [SCOPE.read],
      input: z.object({ limit: z.number().int().positive().max(100).default(25) }),
      request: (i, { config }) => ({ method: 'GET', path: `${base(config)}/api/v2/spaces`, query: { limit: i.limit } }),
      output: (raw) => {
        const r = raw as { results?: Array<{ id?: string; key?: string; name?: string }> };
        return { spaces: (r.results ?? []).map((s) => ({ id: s.id, key: s.key, name: s.name })) };
      },
    }),
  ],
});
