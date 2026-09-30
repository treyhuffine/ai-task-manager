import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './client';
import { getApiCompatibilityIssue, reportApiCompatibility } from '@/lib/client/api-compatibility';
afterEach(() => { vi.unstubAllGlobals(); reportApiCompatibility(null); });
it('advertises the API contract for JSON, raw streaming and attachment uploads', async () => {
  const fetch = vi.fn(async () => Response.json({ ok: true })); vi.stubGlobal('fetch', fetch);
  const api = new ApiClient({ baseUrl: 'http://local.test/api', getToken: () => 'key', onUnauthorized: () => {} });
  await api.post('/tasks', { title: 'test' }); await api.raw('/sessions/send', { method: 'POST', body: '{}' }); await api.upload('/attachments', new FormData());
  for (const [, init] of fetch.mock.calls as unknown as [string, RequestInit][]) {
    expect(new Headers(init.headers).get('x-ri-api-protocol')).toBe('1');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer key');
  }
});
it('keeps auth and exposes an actionable mismatch without retrying a mutation', async () => {
  const unauthorized = vi.fn();
  const issue = { error: 'api_protocol', code: 'api_protocol', update: 'client', protocol: 1, supported: [2], message: 'Reload with your drafts retained.' };
  const fetch = vi.fn(async () => Response.json(issue, { status: 426 })); vi.stubGlobal('fetch', fetch);
  const api = new ApiClient({ baseUrl: 'http://local.test/api', getToken: () => 'key', onUnauthorized: unauthorized });
  await expect(api.post('/tasks', { title: 'kept' })).rejects.toBeInstanceOf(ApiError);
  expect(fetch).toHaveBeenCalledTimes(1); expect(unauthorized).not.toHaveBeenCalled();
  expect(getApiCompatibilityIssue()).toEqual(issue);
});
