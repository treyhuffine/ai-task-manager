/**
 * The `zendesk` toolkit — tickets + search over the Support API v2. Non-OAuth → no action
 * `scopes`. Reads return the relevant collection; mutations wrap their payload under `ticket`.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

interface RawTicket {
  id?: number;
  subject?: string;
  status?: string;
  priority?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

function ticketSummary(t: RawTicket) {
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

export const zendeskToolkit = defineToolkit({
  id: 'zendesk',
  providerId: 'zendesk',
  displayName: 'Zendesk',
  actions: [
    httpAction({
      id: 'zendesk.search',
      description: 'Search Zendesk (tickets, users, orgs) with a query string.',
      input: z.object({ query: z.string() }),
      request: (i) => ({ method: 'GET', path: '/api/v2/search.json', query: { query: i.query } }),
      output: (raw) => {
        const r = raw as { results?: unknown[]; count?: number };
        return { results: r.results ?? [], count: r.count };
      },
    }),

    httpAction({
      id: 'zendesk.list_tickets',
      description: 'List recent tickets.',
      input: z.object({}),
      request: () => ({ method: 'GET', path: '/api/v2/tickets.json' }),
      output: (raw) => {
        const r = raw as { tickets?: RawTicket[] };
        return { tickets: (r.tickets ?? []).map(ticketSummary) };
      },
    }),

    httpAction({
      id: 'zendesk.get_ticket',
      description: 'Get a single ticket by id.',
      input: z.object({ id: z.union([z.string(), z.number()]) }),
      request: (i) => ({ method: 'GET', path: `/api/v2/tickets/${encodeURIComponent(String(i.id))}.json` }),
      output: (raw) => ticketSummary((raw as { ticket?: RawTicket }).ticket ?? {}),
    }),

    httpAction({
      id: 'zendesk.create_ticket',
      description: 'Create a ticket with a subject and an initial comment body.',
      mutating: true,
      risk: 'medium',
      input: z.object({ subject: z.string(), body: z.string(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional() }),
      request: (i) => ({
        method: 'POST',
        path: '/api/v2/tickets.json',
        body: { ticket: { subject: i.subject, comment: { body: i.body }, ...(i.priority ? { priority: i.priority } : {}) } },
      }),
      output: (raw) => ticketSummary((raw as { ticket?: RawTicket }).ticket ?? {}),
    }),

    httpAction({
      id: 'zendesk.add_comment',
      description: 'Add a comment to an existing ticket (public by default).',
      mutating: true,
      risk: 'medium',
      input: z.object({
        id: z.union([z.string(), z.number()]),
        body: z.string(),
        public: z.boolean().default(true),
      }),
      request: (i) => ({
        method: 'PUT',
        path: `/api/v2/tickets/${encodeURIComponent(String(i.id))}.json`,
        body: { ticket: { comment: { body: i.body, public: i.public } } },
      }),
      output: (raw) => ticketSummary((raw as { ticket?: RawTicket }).ticket ?? {}),
    }),
  ],
});
