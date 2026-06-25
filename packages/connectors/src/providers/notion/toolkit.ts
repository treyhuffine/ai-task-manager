/**
 * The `notion` toolkit. Pages/databases/blocks over the Notion REST API. Notion's content is
 * free-form JSON (properties, blocks), so those inputs are `z.record`/`z.array` of `z.any()`
 * while the top-level input stays a Zod object (required for the projection). Every request
 * carries the `Notion-Version` header.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';
import { NOTION_VERSION } from './provider';

const V = { 'Notion-Version': NOTION_VERSION };

interface NotionRichText {
  plain_text?: string;
}
interface NotionProp {
  type?: string;
  title?: NotionRichText[];
}
interface NotionObject {
  id?: string;
  object?: string;
  title?: NotionRichText[];
  properties?: Record<string, NotionProp>;
}

function plain(rt?: NotionRichText[]): string | undefined {
  return rt ? rt.map((t) => t.plain_text ?? '').join('') : undefined;
}

/** Best-effort title: databases carry a top-level title array; pages have a `title`-typed property. */
function titleOf(x: NotionObject): string | undefined {
  if (x.title) return plain(x.title);
  for (const p of Object.values(x.properties ?? {})) {
    if (p?.type === 'title' || p?.title) return plain(p.title);
  }
  return undefined;
}

export const notionToolkit = defineToolkit({
  id: 'notion',
  providerId: 'notion',
  displayName: 'Notion',
  actions: [
    httpAction({
      id: 'notion.search',
      description: 'Search pages and databases the integration can access.',
      input: z.object({ query: z.string().optional(), filter: z.record(z.any()).optional() }),
      request: (i) => ({ method: 'POST', path: '/search', headers: V, body: { query: i.query, filter: i.filter } }),
      output: (raw) => {
        const r = raw as { results?: NotionObject[] };
        return {
          results: (r.results ?? []).map((x) => ({ id: x.id, object: x.object, title: titleOf(x) })),
        };
      },
    }),

    httpAction({
      id: 'notion.get_page',
      description: 'Get a Notion page’s properties by id.',
      input: z.object({ pageId: z.string() }),
      request: (i) => ({ method: 'GET', path: `/pages/${encodeURIComponent(i.pageId)}`, headers: V }),
    }),

    httpAction({
      id: 'notion.create_page',
      description: 'Create a Notion page under a parent page or database.',
      mutating: true,
      risk: 'medium',
      input: z.object({
        parent: z.record(z.any()).describe('e.g. { database_id } or { page_id }'),
        properties: z.record(z.any()),
        children: z.array(z.any()).optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/pages',
        headers: V,
        body: { parent: i.parent, properties: i.properties, ...(i.children ? { children: i.children } : {}) },
      }),
      output: (raw) => {
        const p = raw as NotionObject;
        return { id: p.id, object: p.object };
      },
    }),

    httpAction({
      id: 'notion.update_page',
      description: 'Update a Notion page’s properties.',
      mutating: true,
      risk: 'medium',
      input: z.object({ pageId: z.string(), properties: z.record(z.any()) }),
      request: (i) => ({
        method: 'PATCH',
        path: `/pages/${encodeURIComponent(i.pageId)}`,
        headers: V,
        body: { properties: i.properties },
      }),
      output: (raw) => ({ id: (raw as NotionObject).id }),
    }),

    httpAction({
      id: 'notion.append_blocks',
      description: 'Append block children to a page or block.',
      mutating: true,
      risk: 'medium',
      input: z.object({ blockId: z.string(), children: z.array(z.any()) }),
      request: (i) => ({
        method: 'PATCH',
        path: `/blocks/${encodeURIComponent(i.blockId)}/children`,
        headers: V,
        body: { children: i.children },
      }),
      output: () => ({ updated: true }),
    }),

    httpAction({
      id: 'notion.query_database',
      description: 'Query a Notion database with an optional filter and sorts.',
      input: z.object({
        databaseId: z.string(),
        filter: z.record(z.any()).optional(),
        sorts: z.array(z.any()).optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: `/databases/${encodeURIComponent(i.databaseId)}/query`,
        headers: V,
        body: { ...(i.filter ? { filter: i.filter } : {}), ...(i.sorts ? { sorts: i.sorts } : {}) },
      }),
      output: (raw) => {
        const r = raw as { results?: NotionObject[]; next_cursor?: string | null };
        return {
          results: (r.results ?? []).map((x) => ({ id: x.id, object: x.object, title: titleOf(x) })),
          nextCursor: r.next_cursor ?? undefined,
        };
      },
    }),

    httpAction({
      id: 'notion.get_database',
      description: 'Get a Notion database’s schema/metadata by id.',
      input: z.object({ databaseId: z.string() }),
      request: (i) => ({ method: 'GET', path: `/databases/${encodeURIComponent(i.databaseId)}`, headers: V }),
    }),
  ],
});
