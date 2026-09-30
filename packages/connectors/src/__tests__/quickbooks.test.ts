import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { quickbooks, quickbooksToolkit, registerQuickbooks } from '../providers/quickbooks';
import type { QuickbooksEnvironment } from '../providers/quickbooks';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall, FakeHttpResponse } from '../testing';

const SCOPE = 'com.intuit.quickbooks.accounting';
const REPORT = {
  Header: { ReportName: 'ProfitAndLoss', Currency: 'USD', StartPeriod: '2026-01-01', EndPeriod: '2026-09-30' },
  Columns: { Column: [{ ColTitle: 'Total', ColType: 'Money' }] },
  Rows: { Row: [{ group: 'NetIncome', Summary: { ColData: [{ value: 'Net Income' }, { value: '-1020.00' }] } },
    { ColData: [{ value: 'Other income' }, { value: '0.00' }] }] },
};

function setup(options: { environment?: QuickbooksEnvironment; respond?: (call: FakeHttpCall) => FakeHttpResponse | undefined } = {}) {
  const http = fakeHttp(async (call) => {
    const override = options.respond?.(call);
    if (override) return override;
    const url = new URL(call.url);
    if (url.hostname === 'oauth.platform.intuit.com') {
      return { json: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: SCOPE } };
    }
    if (url.pathname.includes('/companyinfo/')) return { json: { CompanyInfo: { Id: 'R1', CompanyName: 'Acme Inc' } } };
    if (url.pathname.endsWith('/query')) return { json: { QueryResponse: {} } };
    if (url.pathname.includes('/customer/')) return { json: { Customer: { Id: '7', DisplayName: 'Acme', Active: true } } };
    if (url.pathname.includes('/invoice/')) return { json: { Invoice: { Id: '8', SyncToken: '2', TotalAmt: 100, Balance: 0, Line: [{ Amount: 100 }] } } };
    if (url.pathname.includes('/reports/')) return { json: REPORT };
    throw new Error(`Unexpected fixture URL: ${call.url}`);
  });
  const registry = createRegistry();
  registerQuickbooks(registry, { fetch: http.fetch, environment: options.environment });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry, store, authRequests: store, secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([{ id: 'quickbooks', providerId: 'quickbooks', scheme: 'oauth2', scope: 'global',
      oauth: { clientId: 'c', redirectUri: 'https://app.example/cb' }, clientSecret: 's', status: 'active' }]),
    redactor: createRedactor(), approval: { async check() { return 'allow'; } }, fetch: http.fetch,
  });
  async function connect(realmId: string | undefined = 'R1') {
    const begin = await runtime.beginAuth('quickbooks', { scopes: [SCOPE] });
    return runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId,
      params: realmId ? { realmId } : {} });
  }
  return { runtime, http, connect, store };
}

function lastApiCall(s: ReturnType<typeof setup>): FakeHttpCall {
  return s.http.calls.filter((call) => new URL(call.url).hostname.endsWith('quickbooks.api.intuit.com')).at(-1)!;
}

describe('QuickBooks connection setup', () => {
  it.each(['production', 'sandbox'] as const)('verifies and stores company identity in %s', async (environment) => {
    const s = setup({ environment });
    const conn = await s.connect();
    expect(conn).toMatchObject({ accountId: environment === 'sandbox' ? 'sandbox:R1' : 'R1',
      label: environment === 'sandbox' ? 'Acme Inc (sandbox)' : 'Acme Inc', config: { realmId: 'R1', environment } });
    expect(new URL(lastApiCall(s).url).host).toBe(environment === 'sandbox' ? 'sandbox-quickbooks.api.intuit.com' : 'quickbooks.api.intuit.com');
    expect(await s.runtime.testConnection(conn.id)).toMatchObject({ ok: true, verified: true });
    expect(lastApiCall(s).headers.accept).toBe('application/json');
    expect(quickbooks().identityScopes).toEqual([SCOPE]);
  });

  it('keeps old connections on production without an environment field', async () => {
    const s = setup({ environment: 'sandbox' });
    const conn = await s.connect();
    const stored = (await s.store.get(conn.id))!;
    await s.store.save({ ...stored.connection, config: { realmId: 'R1' } }, stored.sealed);
    expect(await s.runtime.runAction('quickbooks.get_company_info', {})).toMatchObject({ ok: true, result: { CompanyName: 'Acme Inc' } });
    expect(new URL(lastApiCall(s).url).host).toBe('quickbooks.api.intuit.com');
  });

  it.each(['', '../other', 'R1?host=evil', 'https://example.test'])('rejects invalid callback realm %j before an API request', async (realm) => {
    const s = setup();
    await expect(s.connect(realm)).rejects.toMatchObject({ code: 'provider_not_configured' });
    expect(s.http.calls.filter((call) => call.url.includes('/v3/company/'))).toHaveLength(0);
    expect(await s.store.list()).toHaveLength(0);
  });

  it('does not save a company connection when its verification returns a Fault', async () => {
    const s = setup({ respond: (call) => call.url.includes('/companyinfo/') ? { json: { Fault: { Error: [{ Detail: 'private provider detail' }] } } } : undefined });
    await expect(s.connect()).rejects.toMatchObject({ code: 'provider_error' });
    expect(await s.store.list()).toHaveLength(0);
  });
});

describe('QuickBooks reads', () => {
  it('preserves existing query envelopes, count results and customer fields', async () => {
    const s = setup({ respond: (call) => call.url.includes('/query?') ? { json: { QueryResponse: { totalCount: 42 } } } : undefined });
    await s.connect();
    expect(await s.runtime.runAction('quickbooks.query', { query: 'SELECT COUNT(*) FROM Customer' })).toMatchObject({ ok: true, result: { totalCount: 42 } });
    expect(await s.runtime.runAction('quickbooks.get_customer', { id: '7' })).toMatchObject({ ok: true, result: { Id: '7', DisplayName: 'Acme', Active: true } });
    expect(await s.runtime.runAction('quickbooks.get_invoice', { id: '8' })).toMatchObject({ ok: true, result: { Id: '8', Balance: 0, Line: [{ Amount: 100 }] } });
  });

  it.each(['DELETE FROM Invoice', 'SELECT * FROM Customer; SELECT * FROM Invoice', 'SELECT * FROM Customer -- comment',
    "SELECT * FROM Customer WHERE DisplayName = 'unclosed", 'SELECT * INTO Invoice FROM Customer'])('rejects unsafe query %j without HTTP', async (query) => {
    const s = setup(); await s.connect(); const before = s.http.calls.length;
    expect(await s.runtime.runAction('quickbooks.query', { query })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(s.http.calls).toHaveLength(before);
  });

  it('accepts keywords and punctuation inside escaped query literals', async () => {
    const s = setup(); await s.connect();
    const query = "SELECT * FROM Customer WHERE DisplayName = 'O\\'Brien; UPDATE -- SELECT' STARTPOSITION 1 MAXRESULTS 10";
    expect(await s.runtime.runAction('quickbooks.query', { query })).toMatchObject({ ok: true });
    expect(new URL(lastApiCall(s).url).searchParams.get('query')).toBe(query);
  });

  it('paginates invoices with a lookahead record and combines exact filters', async () => {
    const s = setup({ respond: (call) => {
      const url = new URL(call.url);
      if (!url.pathname.endsWith('/query')) return undefined;
      return { json: { QueryResponse: { Invoice: url.searchParams.get('query')!.includes('STARTPOSITION 1 ')
        ? [{ Id: '3' }, { Id: '2' }, { Id: '1' }] : [{ Id: '1' }], totalCount: 3 } } };
    } });
    await s.connect();
    const filters = { customer_id: "O'Brien", start_date: '2026-01-01', end_date: '2026-09-30', unpaid_only: true, limit: 2 };
    expect(await s.runtime.runAction('quickbooks.list_invoices', filters)).toMatchObject({ ok: true, result: {
      Invoice: [{ Id: '3' }, { Id: '2' }], totalCount: 3, startPosition: 1, maxResults: 2, next_start_position: 3,
    } });
    const query = new URL(lastApiCall(s).url).searchParams.get('query')!;
    expect(query).toContain("CustomerRef = 'O\\'Brien' AND TxnDate >= '2026-01-01' AND TxnDate <= '2026-09-30' AND Balance > '0'");
    expect(query).toContain('ORDERBY TxnDate DESC STARTPOSITION 1 MAXRESULTS 3');
    expect(await s.runtime.runAction('quickbooks.list_invoices', { ...filters, start_position: 3 })).toMatchObject({ ok: true, result: {
      Invoice: [{ Id: '1' }], maxResults: 1, next_start_position: null,
    } });
  });

  it('handles empty and exact-size customer pages and escapes display names', async () => {
    let records: Array<{ Id: string }> = [];
    const s = setup({ respond: (call) => call.url.includes('/query?') ? { json: { QueryResponse: { Customer: records } } } : undefined });
    await s.connect();
    expect(await s.runtime.runAction('quickbooks.list_customers', { active: 'all', display_name: "O'Brien\\Inc", limit: 1 })).toMatchObject({ ok: true, result: { Customer: [], next_start_position: null } });
    expect(new URL(lastApiCall(s).url).searchParams.get('query')).toContain("Active IN (true, false) AND DisplayName = 'O\\'Brien\\\\Inc'");
    records = [{ Id: '7' }];
    expect(await s.runtime.runAction('quickbooks.list_customers', { limit: 1 })).toMatchObject({ ok: true, result: { Customer: records, maxResults: 1, next_start_position: null } });
  });

  it.each([
    ['quickbooks.query', { query: 'SELECT * FROM Invoice' }, { Fault: { Error: [] } }],
    ['quickbooks.query', { query: 'SELECT * FROM Invoice' }, {}],
    ['quickbooks.get_invoice', { id: '1' }, { Invoice: [] }],
    ['quickbooks.list_invoices', {}, { QueryResponse: { Invoice: 'invalid' } }],
    ['quickbooks.get_profit_and_loss', {}, { Header: {} }],
  ])('returns a provider error for malformed %s data', async (name, input, raw) => {
    const s = setup({ respond: (call) => call.url.includes('/v3/company/') && !call.url.includes('/companyinfo/') ? { json: raw } : undefined });
    await s.connect();
    const outcome = await s.runtime.runAction(name as string, input);
    expect(outcome).toMatchObject({ ok: false, code: 'provider_error' });
    expect(outcome).not.toMatchObject({ indeterminate: true });
  });

  it('bounds pagination and rejects impossible or reversed dates before HTTP', async () => {
    const s = setup(); await s.connect(); const before = s.http.calls.length;
    for (const input of [{ limit: 1000 }, { start_position: 0 }, { start_date: '2026-02-29' }, { start_date: '2026-10-01', end_date: '2026-01-01' }]) {
      expect(await s.runtime.runAction('quickbooks.list_invoices', input)).toMatchObject({ ok: false, code: 'invalid_input' });
    }
    expect(await s.runtime.runAction('quickbooks.get_invoice', { id: '..' })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(s.http.calls).toHaveLength(before);
  });
});

describe('QuickBooks financial reports', () => {
  it.each([
    ['profit_and_loss', 'ProfitAndLoss'], ['balance_sheet', 'BalanceSheet'], ['cash_flow', 'CashFlow'],
    ['trial_balance', 'TrialBalance'], ['general_ledger', 'GeneralLedger'],
    ['aged_receivables', 'AgedReceivables'], ['aged_payables', 'AgedPayables'],
  ])('reads %s without flattening financial amounts', async (name, report) => {
    const s = setup({ environment: 'sandbox' }); await s.connect();
    expect(await s.runtime.runAction(`quickbooks.get_${name}`, {})).toMatchObject({ ok: true, result: REPORT });
    const call = lastApiCall(s);
    expect(call.method).toBe('GET');
    expect(call.url).toBe(`https://sandbox-quickbooks.api.intuit.com/v3/company/R1/reports/${report}`);
  });

  it('passes report-specific filters and fixes the as-of-only balance sheet API behavior', async () => {
    const s = setup(); await s.connect();
    expect(await s.runtime.runAction('quickbooks.get_balance_sheet', { end_date: '2026-09-30', accounting_method: 'Accrual' })).toMatchObject({ ok: true });
    expect(Object.fromEntries(new URL(lastApiCall(s).url).searchParams)).toEqual({ start_date: '2026-01-01', end_date: '2026-09-30', accounting_method: 'Accrual' });
    expect(await s.runtime.runAction('quickbooks.get_aged_receivables', { report_date: '2026-09-30', customer: '7', aging_method: 'Report_Date', days_per_aging_period: 30, num_periods: 4 })).toMatchObject({ ok: true });
    expect(Object.fromEntries(new URL(lastApiCall(s).url).searchParams)).toEqual({ report_date: '2026-09-30', customer: '7', aging_method: 'Report_Date', days_per_aging_period: '30', num_periods: '4' });
    expect(await s.runtime.runAction('quickbooks.get_general_ledger', { account_id: '42', source_account: '7' })).toMatchObject({ ok: true });
    expect(Object.fromEntries(new URL(lastApiCall(s).url).searchParams)).toEqual({ account: '42', source_account: '7' });
    const before = s.http.calls.length;
    expect(await s.runtime.runAction('quickbooks.get_cash_flow', { accounting_method: 'Cash' })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(await s.runtime.runAction('quickbooks.get_profit_and_loss', { start_date: '2026-09-30', end_date: '2026-01-01' })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(s.http.calls).toHaveLength(before);
  });

  it('exposes only read actions under the accounting scope', () => {
    expect(quickbooksToolkit.actions).toHaveLength(13);
    for (const action of quickbooksToolkit.actions) {
      expect(action.mutating).toBe(false);
      expect(action.scopes).toEqual([SCOPE]);
    }
  });
});
