/**
 * The `quickbooks` toolkit (read-first). The company (`realmId`) is captured on the connection at
 * connect (see provider.ts identify, from the OAuth callback) and read from `ctx.config` in each
 * action's `request(input, { config })` — never an action input. Each action builds an ABSOLUTE
 * Intuit Accounting API URL and sends `Accept: application/json` (Intuit defaults to XML otherwise).
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

const SCOPE = 'com.intuit.quickbooks.accounting';
const JSON_HEADERS = { Accept: 'application/json' };

/** Per-company Intuit Accounting API base, from the connection's stored realmId. */
function base(config: Record<string, unknown>): string {
  return `https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(String(config.realmId))}`;
}

export const quickbooksToolkit = defineToolkit({
  id: 'quickbooks',
  providerId: 'quickbooks',
  displayName: 'QuickBooks',
  actions: [
    httpAction({
      id: 'quickbooks.query',
      description: 'Run a QuickBooks SQL-like query (e.g. "SELECT * FROM Customer MAXRESULTS 20").',
      scopes: [SCOPE],
      input: z.object({
        query: z.string().describe('Intuit query, e.g. SELECT * FROM Customer MAXRESULTS 20'),
      }),
      request: (i, { config }) => ({ method: 'GET', path: `${base(config)}/query`, query: { query: i.query }, headers: JSON_HEADERS }),
      output: (raw) => {
        const r = raw as { QueryResponse?: unknown };
        return r.QueryResponse ?? raw;
      },
    }),

    httpAction({
      id: 'quickbooks.get_customer',
      description: 'Get a QuickBooks customer by id.',
      scopes: [SCOPE],
      input: z.object({ id: z.string() }),
      request: (i, { config }) => ({ method: 'GET', path: `${base(config)}/customer/${encodeURIComponent(i.id)}`, headers: JSON_HEADERS }),
      output: (raw) => {
        const r = raw as { Customer?: unknown };
        return r.Customer ?? raw;
      },
    }),

    httpAction({
      id: 'quickbooks.list_invoices',
      description: 'List recent QuickBooks invoices.',
      scopes: [SCOPE],
      input: z.object({}),
      request: (_i, { config }) => ({
        method: 'GET',
        path: `${base(config)}/query`,
        query: { query: 'SELECT * FROM Invoice MAXRESULTS 20' },
        headers: JSON_HEADERS,
      }),
      output: (raw) => {
        const r = raw as { QueryResponse?: unknown };
        return r.QueryResponse ?? raw;
      },
    }),

    httpAction({
      id: 'quickbooks.get_company_info',
      description: 'Get the QuickBooks company (organization) info.',
      scopes: [SCOPE],
      input: z.object({}),
      request: (_i, { config }) => ({
        method: 'GET',
        path: `${base(config)}/companyinfo/${encodeURIComponent(String(config.realmId))}`,
        headers: JSON_HEADERS,
      }),
      output: (raw) => {
        const r = raw as { CompanyInfo?: unknown };
        return r.CompanyInfo ?? raw;
      },
    }),
  ],
});
