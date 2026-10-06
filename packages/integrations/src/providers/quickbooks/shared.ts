import { IntegrationError } from '../../core/errors';

export const QUICKBOOKS_ACCOUNTING_SCOPE = 'com.intuit.quickbooks.accounting';
export type QuickbooksEnvironment = 'production' | 'sandbox';
export const QUICKBOOKS_JSON_HEADERS = { Accept: 'application/json' };

export function quickbooksEnvironment(value: unknown): QuickbooksEnvironment {
  if (value === undefined || value === 'production') return 'production';
  if (value === 'sandbox') return 'sandbox';
  throw new IntegrationError('provider_not_configured', 'QuickBooks environment must be production or sandbox.');
}

export function quickbooksRealm(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new IntegrationError('provider_not_configured', 'QuickBooks company ID is missing or invalid. Reconnect the company.');
  }
  return value;
}

export function quickbooksBase(config: Record<string, unknown>): string {
  const environment = quickbooksEnvironment(config.environment);
  const host = environment === 'sandbox' ? 'sandbox-quickbooks.api.intuit.com' : 'quickbooks.api.intuit.com';
  return `https://${host}/v3/company/${encodeURIComponent(quickbooksRealm(config.realmId))}`;
}

export function quickbooksObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new IntegrationError('provider_error', 'QuickBooks returned an invalid response.');
  }
  const result = raw as Record<string, unknown>;
  if (result.Fault !== undefined) {
    // Do not return a provider Fault as successful accounting data or expose raw provider text.
    throw new IntegrationError('provider_error', 'QuickBooks rejected the request. Check the query, filters and company permissions.');
  }
  return result;
}

export function quickbooksEntity(raw: unknown, name: string): Record<string, unknown> {
  const value = quickbooksObject(raw)[name];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IntegrationError('provider_error', `QuickBooks response is missing ${name}.`);
  }
  return value as Record<string, unknown>;
}
