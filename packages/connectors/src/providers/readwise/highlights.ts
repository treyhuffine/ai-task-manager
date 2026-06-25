/**
 * The `readwise` toolkit — highlights, books, and Reader documents. Non-OAuth, so no `scopes`.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

export const readwiseHighlights = defineToolkit({
  id: 'readwise',
  providerId: 'readwise',
  displayName: 'Readwise',
  actions: [
    httpAction({
      id: 'readwise.list_highlights',
      description: 'List highlights (paginated).',
      input: z.object({
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().max(1000).default(50),
        book_id: z.number().int().optional(),
      }),
      request: (i) => ({ method: 'GET', path: '/highlights/', query: { page: i.page, page_size: i.page_size, book_id: i.book_id } }),
      output: (raw) => {
        const r = raw as { count?: number; results?: unknown[]; next?: string };
        return { count: r.count, results: r.results ?? [], next: r.next ?? undefined };
      },
    }),

    httpAction({
      id: 'readwise.list_books',
      description: 'List books/sources (paginated).',
      input: z.object({ page: z.number().int().positive().optional(), page_size: z.number().int().positive().max(1000).default(50) }),
      request: (i) => ({ method: 'GET', path: '/books/', query: { page: i.page, page_size: i.page_size } }),
      output: (raw) => {
        const r = raw as { count?: number; results?: unknown[] };
        return { count: r.count, results: r.results ?? [] };
      },
    }),

    httpAction({
      id: 'readwise.create_highlight',
      description: 'Create one or more highlights.',
      mutating: true,
      risk: 'low',
      input: z.object({
        highlights: z.array(
          z.object({
            text: z.string(),
            title: z.string().optional(),
            author: z.string().optional(),
            source_url: z.string().optional(),
            note: z.string().optional(),
          }),
        ),
      }),
      request: (i) => ({ method: 'POST', path: '/highlights/', body: { highlights: i.highlights } }),
      output: (raw) => ({ created: raw }),
    }),

    httpAction({
      id: 'readwise.list_documents',
      description: 'List Reader documents (Readwise Reader v3).',
      input: z.object({ location: z.string().optional().describe('new | later | archive | feed'), pageCursor: z.string().optional() }),
      request: (i) => ({ method: 'GET', path: 'https://readwise.io/api/v3/list/', query: { location: i.location, pageCursor: i.pageCursor } }),
      output: (raw) => {
        const r = raw as { count?: number; results?: unknown[]; nextPageCursor?: string };
        return { count: r.count, results: r.results ?? [], nextPageCursor: r.nextPageCursor ?? undefined };
      },
    }),
  ],
});
