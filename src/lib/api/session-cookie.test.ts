/**
 * `syncSessionCookie` mirrors the browser's token into the session cookie
 * that an HTML preview's iframe authenticates with. A preview opened right
 * after pairing waits on the same request PairingBootstrap started.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  storage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('window', {
    location: { hash: '' },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('posts once per token, and every caller waits on that request', async () => {
  const { syncSessionCookie } = await import('./client');
  let finish!: () => void;
  fetchMock.mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(new Response(null, { status: 204 })); }));
  const bootstrap = syncSessionCookie('ri_live_one');
  let previewReady = false;
  const preview = syncSessionCookie('ri_live_one').then(() => { previewReady = true; });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/session', { method: 'POST', headers: { authorization: 'Bearer ri_live_one' } });
  await Promise.resolve();
  expect(previewReady).toBe(false);
  finish();
  await Promise.all([bootstrap, preview]);
  expect(previewReady).toBe(true);

  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await syncSessionCookie('ri_live_two');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('uses the stored token by default, resolves when the request fails, and skips without a token', async () => {
  const { AUTH_TOKEN_STORAGE_KEY, syncSessionCookie } = await import('./client');
  await syncSessionCookie();
  expect(fetchMock).not.toHaveBeenCalled();

  storage.set(AUTH_TOKEN_STORAGE_KEY, 'ri_live_stored');
  fetchMock.mockRejectedValueOnce(new TypeError('offline'));
  await expect(syncSessionCookie()).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({ headers: { authorization: 'Bearer ri_live_stored' } }));
});
