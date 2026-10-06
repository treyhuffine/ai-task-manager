/**
 * The `plaid` toolkit — accounts, balances, transactions, item info. Every call is a POST whose
 * body gets `client_id`/`secret` merged in by the custom auth strategy; the `access_token` (the
 * linked item) is an action input. Non-OAuth, so no `scopes`.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

export const plaidToolkit = defineToolkit({
  id: 'plaid',
  providerId: 'plaid',
  displayName: 'Plaid',
  actions: [
    httpAction({
      id: 'plaid.get_accounts',
      description: 'Get the accounts for a linked item (access_token).',
      input: z.object({ access_token: z.string() }),
      request: (i) => ({ method: 'POST', path: '/accounts/get', body: { access_token: i.access_token } }),
      output: (raw) => {
        const r = raw as { accounts?: unknown[]; item?: unknown };
        return { accounts: r.accounts ?? [], item: r.item };
      },
    }),
    httpAction({
      id: 'plaid.get_balance',
      description: 'Get real-time balances for a linked item.',
      input: z.object({ access_token: z.string() }),
      request: (i) => ({ method: 'POST', path: '/accounts/balance/get', body: { access_token: i.access_token } }),
      output: (raw) => {
        const r = raw as { accounts?: unknown[] };
        return { accounts: r.accounts ?? [] };
      },
    }),
    httpAction({
      id: 'plaid.get_transactions',
      description: 'Get transactions for a linked item over a date range (YYYY-MM-DD).',
      input: z.object({
        access_token: z.string(),
        start_date: z.string(),
        end_date: z.string(),
        count: z.number().int().positive().max(500).optional(),
        offset: z.number().int().min(0).optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/transactions/get',
        body: {
          access_token: i.access_token,
          start_date: i.start_date,
          end_date: i.end_date,
          ...(i.count !== undefined || i.offset !== undefined ? { options: { count: i.count, offset: i.offset } } : {}),
        },
      }),
      output: (raw) => {
        const r = raw as { transactions?: unknown[]; total_transactions?: number };
        return { transactions: r.transactions ?? [], total: r.total_transactions ?? 0 };
      },
    }),
    httpAction({
      id: 'plaid.get_item',
      description: 'Get metadata about a linked item.',
      input: z.object({ access_token: z.string() }),
      request: (i) => ({ method: 'POST', path: '/item/get', body: { access_token: i.access_token } }),
      output: (raw) => raw,
    }),
  ],
});
