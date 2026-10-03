import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient, apiErrorText, apiErrorCode } from '@/lib/api/client';
import { apiErrorStatus } from '@/lib/api/error-status';
import { getApiCompatibilityIssue, reportApiCompatibility } from '@/lib/client/api-compatibility';
import { createAppTRPCClient } from './client';
import { tasksApi } from '@/lib/api/tasks';

afterEach(() => { vi.unstubAllGlobals(); reportApiCompatibility(null); });

it('uses the correct endpoint with the shared auth/protocol transport', async () => {
  const fetch = vi.fn(async () => Response.json([{ result: { data: [] } }]));
  vi.stubGlobal('fetch', fetch);
  const client = createAppTRPCClient();
  await expect(client.tasks.list.query()).resolves.toEqual([]);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URL(url).pathname).toBe('/api/trpc/tasks.list');
  expect(new Headers(init.headers).get('x-ri-api-protocol')).toBe('1');
});

it('retains a pre-adapter protocol refusal and never retries a mutation or clears authentication', async () => {
  const issue = { error: 'api_protocol', code: 'api_protocol', update: 'client', protocol: 1, supported: [2], message: 'Reload with your drafts retained.' };
  const fetch = vi.fn(async () => Response.json(issue, { status: 426 }));
  vi.stubGlobal('fetch', fetch);
  const unauthorized = vi.fn();
  const client = createAppTRPCClient({ transport: new ApiClient({ getToken: () => 'key', onUnauthorized: unauthorized }) });
  let error: unknown;
  try { await client.tasks.create.mutate({ title: 'Retained', rawInput: 'Retained' }); } catch (err) { error = err; }
  expect(apiErrorStatus(error)).toBe(426);
  expect(apiErrorCode(error)).toBe('api_protocol');
  expect(apiErrorText(error)).toBe(issue.message);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(unauthorized).not.toHaveBeenCalled();
  expect(getApiCompatibilityIssue()).toEqual(issue);
});

it('runs the existing unauthorized recovery for a pre-adapter 401', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ error: 'unauthorized' }, { status: 401 }));
  const unauthorized = vi.fn();
  const client = createAppTRPCClient({ transport: new ApiClient({ getToken: () => 'expired', onUnauthorized: unauthorized }) });
  let error: unknown;
  try { await client.notes.list.query(); } catch (err) { error = err; }
  expect(apiErrorStatus(error)).toBe(401);
  expect(apiErrorText(error)).toBe('unauthorized');
  expect(unauthorized).toHaveBeenCalledOnce();
});

it.each([false, true])('retains maintenance refusals before the adapter (custom headers: %s)', async customHeaders => {
  const refusal = { error: 'maintenance', code: 'maintenance', message: 'Home is restarting. Your draft is retained.' };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(refusal, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const unauthorized = vi.fn();
  const client = createAppTRPCClient({ transport: new ApiClient({ getToken: () => 'key', onUnauthorized: unauthorized }) });
  let error: unknown;
  try {
    await client.tasks.update.mutate({ id: 'task', patch: { title: 'Retained' } },
      customHeaders ? { context: { headers: { 'x-ri-device-id': 'viewer' } } } : undefined);
  } catch (err) { error = err; }
  expect(apiErrorStatus(error)).toBe(503);
  expect(apiErrorCode(error)).toBe('maintenance');
  expect(apiErrorText(error)).toBe(refusal.message);
  // Reachability recovery may also probe /health, but never resend this save.
  expect(fetch.mock.calls.filter(([url]) => String(url).includes('/api/trpc/'))).toHaveLength(1);
  expect(unauthorized).not.toHaveBeenCalled();
});

it('retains a non-JSON gateway status so refused saves remain retryable', async () => {
  vi.stubGlobal('fetch', async () => new Response('Gateway unavailable', { status: 502 }));
  const client = createAppTRPCClient();
  let error: unknown;
  try { await client.notes.update.mutate({ id: 'note', patch: { body: 'Still here' } }); } catch (err) { error = err; }
  expect(apiErrorStatus(error)).toBe(502);
});

it('leaves a procedure error envelope to tRPC and preserves its domain details', async () => {
  vi.stubGlobal('fetch', async () => Response.json([{ error: {
    message: 'Choose how to stop the running work.', code: -32009,
    data: { code: 'CONFLICT', httpStatus: 409, path: 'tasks.update', domainCode: 'running_work', details: { taskId: 'task' } },
  } }], { status: 409 }));
  const client = createAppTRPCClient();
  let error: unknown;
  try { await client.tasks.update.mutate({ id: 'task', patch: { title: 'Retained' } }); } catch (err) { error = err; }
  expect(apiErrorStatus(error)).toBe(409);
  expect(apiErrorCode(error)).toBe('running_work');
  expect(apiErrorText(error)).toBe('Choose how to stop the running work.');
});

it('splits large boards into bounded attention calls and keeps every returned badge', async () => {
  const batches: string[][] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const request = new URL(url);
    const inputs = JSON.parse(request.searchParams.get('input')!) as Record<string, { ids: string[] }>;
    return Response.json(Object.values(inputs).map(({ ids }) => {
      batches.push(ids);
      return { result: { data: Object.fromEntries(ids.map(id => [id, { blocked: false }])) } };
    }));
  });
  const ids = Array.from({ length: 405 }, (_, i) => `task-${i}`);
  expect(Object.keys(await tasksApi.attention([...ids, ids[0]]))).toHaveLength(405);
  expect(batches.map(ids => ids.length)).toEqual([200, 200, 5]);
  expect(await tasksApi.attention([])).toEqual({});
});
