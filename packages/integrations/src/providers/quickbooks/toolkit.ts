/** Read-only Accounting API actions. Company and environment are bound to the connection. */
import { z } from 'zod';
import { action, defineToolkit, httpAction } from '../../core/authoring';
import { IntegrationError } from '../../core/errors';
import {
  QUICKBOOKS_ACCOUNTING_SCOPE as SCOPE, QUICKBOOKS_JSON_HEADERS as JSON_HEADERS,
  quickbooksBase as base, quickbooksEntity, quickbooksObject, quickbooksRealm,
} from './shared';

const id = z.string().trim().min(1).max(128);
const entityId = id.regex(/^[A-Za-z0-9_-]+$/, 'Use a QuickBooks entity ID');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a valid calendar date');
const accountingMethod = z.enum(['Cash', 'Accrual']).optional();
const period = { start_date: date.optional(), end_date: date.optional() };
const page = {
  limit: z.number().int().min(1).max(999).default(20).describe('Page size, up to 999. One extra record is read to detect the next page.'),
  start_position: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1000).default(1)
    .describe('One-based position. Use next_start_position from the preceding page.'),
};

function checkPeriod(input: { start_date?: string; end_date?: string }): void {
  if (input.start_date && input.end_date && input.start_date > input.end_date) {
    throw new IntegrationError('invalid_input', 'start_date must be on or before end_date.');
  }
}

/** Intuit query literals use backslash escaping. All other query pieces below are fixed or numeric. */
function literal(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Accept one SELECT only. Ignore quoted values when checking keywords and delimiters. */
function readQuery(value: string): string {
  const query = value.trim();
  let outside = '';
  let quoted = false;
  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    if (quoted && char === '\\') { i++; continue; }
    if (char === "'") { quoted = !quoted; outside += ' '; continue; }
    if (!quoted) outside += char;
  }
  if (quoted || !/^SELECT\b/i.test(outside) || (outside.match(/\bSELECT\b/gi)?.length ?? 0) !== 1
    || (outside.match(/\bFROM\b/gi)?.length ?? 0) !== 1 || /;|--|\/\*|\*\//.test(outside)
    || /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|EXEC|EXECUTE|GRANT|REVOKE|UNION|JOIN|INTO)\b/i.test(outside)) {
    throw new IntegrationError('invalid_input', 'QuickBooks query accepts one read-only SELECT statement, without comments or statement separators.');
  }
  return query;
}

function queryResponse(raw: unknown): Record<string, unknown> {
  return quickbooksEntity(raw, 'QueryResponse');
}

function pagedResponse(raw: unknown, entity: string, input: { limit: number; start_position: number }): Record<string, unknown> {
  const result = queryResponse(raw);
  const records = result[entity] ?? [];
  if (!Array.isArray(records) || records.some((record) => !record || typeof record !== 'object' || Array.isArray(record))) {
    throw new IntegrationError('provider_error', `QuickBooks returned invalid ${entity} records.`);
  }
  const items = records.slice(0, input.limit);
  return {
    ...result, [entity]: items, startPosition: input.start_position, maxResults: items.length,
    next_start_position: records.length > input.limit ? input.start_position + input.limit : null,
  };
}

function reportResponse(raw: unknown): Record<string, unknown> {
  const report = quickbooksObject(raw);
  for (const field of ['Header', 'Columns']) {
    if (!report[field] || typeof report[field] !== 'object' || Array.isArray(report[field])) {
      throw new IntegrationError('provider_error', `QuickBooks report is missing ${field}.`);
    }
  }
  if (report.Rows !== undefined && (!report.Rows || typeof report.Rows !== 'object' || Array.isArray(report.Rows))) {
    throw new IntegrationError('provider_error', 'QuickBooks report has invalid Rows.');
  }
  return report;
}

const reportSpecs: Array<{ id: string; report: string; description: string; fields: z.ZodRawShape }> = [
  {
    id: 'profit_and_loss', report: 'ProfitAndLoss', description: 'Get the QuickBooks profit and loss report. Returns the original report hierarchy and formatted amounts.',
    fields: { ...period, accounting_method: accountingMethod, summarize_column_by: z.enum(['Total', 'Month', 'Week', 'Days', 'Classes']).optional(),
      customer: id.optional(), vendor: id.optional(), item: id.optional(), department: id.optional(), class: id.optional() },
  },
  {
    id: 'balance_sheet', report: 'BalanceSheet', description: 'Get the QuickBooks balance sheet. Set end_date for an as-of date. If start_date is omitted, January 1 of that year is supplied so QuickBooks honors end_date.',
    fields: { ...period, accounting_method: accountingMethod, summarize_column_by: z.enum(['Total', 'Month', 'Week', 'Days']).optional() },
  },
  {
    id: 'cash_flow', report: 'CashFlow', description: 'Get the QuickBooks cash flow report for an optional date range.',
    fields: { ...period, summarize_column_by: z.enum(['Total', 'Month', 'Week', 'Days']).optional() },
  },
  {
    id: 'trial_balance', report: 'TrialBalance', description: 'Get the QuickBooks trial balance report for an optional date range and accounting method.',
    fields: { ...period, accounting_method: accountingMethod },
  },
  {
    id: 'general_ledger', report: 'GeneralLedger', description: 'Get the QuickBooks general ledger. Optional account_id and source_account filters use QuickBooks account IDs.',
    fields: { ...period, accounting_method: accountingMethod, account_id: id.optional(), source_account: id.optional() },
  },
  {
    id: 'aged_receivables', report: 'AgedReceivables', description: 'Get the QuickBooks accounts receivable aging summary, optionally for a customer and report date.',
    fields: { report_date: date.optional(), customer: id.optional(), aging_method: z.enum(['Current', 'Report_Date']).optional(),
      days_per_aging_period: z.number().int().min(1).max(365).optional(), num_periods: z.number().int().min(1).max(12).optional() },
  },
  {
    id: 'aged_payables', report: 'AgedPayables', description: 'Get the QuickBooks accounts payable aging summary, optionally for a vendor and report date.',
    fields: { report_date: date.optional(), vendor: id.optional(), aging_method: z.enum(['Current', 'Report_Date']).optional(),
      days_per_aging_period: z.number().int().min(1).max(365).optional(), num_periods: z.number().int().min(1).max(12).optional() },
  },
];

export const quickbooksToolkit = defineToolkit({
  id: 'quickbooks', providerId: 'quickbooks', displayName: 'QuickBooks',
  actions: [
    httpAction({
      id: 'quickbooks.query',
      description: 'Run one read-only QuickBooks SELECT query. Use STARTPOSITION and MAXRESULTS (up to 1000) for pagination. Returns QueryResponse, including entity arrays or count results.',
      scopes: [SCOPE],
      input: z.object({ query: z.string().min(1).max(16000).describe('Example: SELECT * FROM Customer STARTPOSITION 1 MAXRESULTS 100') }),
      request: (i, { config }) => ({ method: 'GET', path: `${base(config)}/query`, query: { query: readQuery(i.query) }, headers: JSON_HEADERS }),
      output: queryResponse,
    }),
    ...(['Customer', 'Invoice'] as const).map((entity) => httpAction({
      id: `quickbooks.get_${entity.toLowerCase()}`,
      description: `Get a complete QuickBooks ${entity.toLowerCase()} by ID.`, scopes: [SCOPE], input: z.object({ id: entityId }),
      request: (i, { config }) => ({ method: 'GET', path: `${base(config)}/${entity.toLowerCase()}/${encodeURIComponent(i.id)}`, headers: JSON_HEADERS }),
      output: (raw) => quickbooksEntity(raw, entity),
    })),
    action({
      id: 'quickbooks.list_invoices',
      description: 'List QuickBooks invoices by descending transaction date, with optional customer, date range and unpaid filters. Follow next_start_position until null. Returns Invoice records and page metadata.',
      scopes: [SCOPE], mutating: false,
      input: z.object({ ...page, ...period, customer_id: id.optional(), unpaid_only: z.boolean().default(false) }),
      async execute(ctx, input) {
        checkPeriod(input);
        const filters = [
          ...(input.customer_id ? [`CustomerRef = ${literal(input.customer_id)}`] : []),
          ...(input.start_date ? [`TxnDate >= ${literal(input.start_date)}`] : []),
          ...(input.end_date ? [`TxnDate <= ${literal(input.end_date)}`] : []),
          ...(input.unpaid_only ? ['Balance > \'0\''] : []),
        ];
        const query = `SELECT * FROM Invoice${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''} ORDERBY TxnDate DESC STARTPOSITION ${input.start_position} MAXRESULTS ${input.limit + 1}`;
        return pagedResponse(await ctx.http.get(`${base(ctx.config)}/query`, { query: { query }, headers: JSON_HEADERS }), 'Invoice', input);
      },
    }),
    action({
      id: 'quickbooks.list_customers',
      description: 'List QuickBooks customers by display name. active defaults to true. Set false for inactive customers or all for both. Follow next_start_position until null.',
      scopes: [SCOPE], mutating: false,
      input: z.object({ ...page, display_name: z.string().min(1).max(500).optional(), active: z.enum(['true', 'false', 'all']).default('true') }),
      async execute(ctx, input) {
        const filters = [input.active === 'all' ? 'Active IN (true, false)' : `Active = ${input.active}`,
          ...(input.display_name ? [`DisplayName = ${literal(input.display_name)}`] : [])];
        const query = `SELECT * FROM Customer WHERE ${filters.join(' AND ')} ORDERBY DisplayName ASC STARTPOSITION ${input.start_position} MAXRESULTS ${input.limit + 1}`;
        return pagedResponse(await ctx.http.get(`${base(ctx.config)}/query`, { query: { query }, headers: JSON_HEADERS }), 'Customer', input);
      },
    }),
    httpAction({
      id: 'quickbooks.get_company_info', description: 'Get the connected QuickBooks company information.', scopes: [SCOPE], input: z.object({}),
      request: (_i, { config }) => ({ method: 'GET', path: `${base(config)}/companyinfo/${encodeURIComponent(quickbooksRealm(config.realmId))}`, headers: JSON_HEADERS }),
      output: (raw) => quickbooksEntity(raw, 'CompanyInfo'),
    }),
    ...reportSpecs.map((spec) => httpAction({
      id: `quickbooks.get_${spec.id}`, description: spec.description, scopes: [SCOPE],
      // Keep an object schema for MCP/tool projections. Cross-field date checks happen before HTTP.
      input: z.object(spec.fields).strict(),
      request: (input, { config }) => {
        const query = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Record<string, string | number>;
        if (query.account_id !== undefined) {
          query.account = query.account_id;
          delete query.account_id;
        }
        checkPeriod(query as { start_date?: string; end_date?: string });
        if (spec.report === 'BalanceSheet' && query.end_date && !query.start_date) {
          query.start_date = `${String(query.end_date).slice(0, 4)}-01-01`;
        }
        return { method: 'GET', path: `${base(config)}/reports/${spec.report}`, query, headers: JSON_HEADERS };
      },
      output: reportResponse,
    })),
  ],
});
