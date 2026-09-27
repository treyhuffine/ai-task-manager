import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import manifest from '@/app/manifest';

const script = readFileSync(resolve('public/notifications-sw.js'), 'utf8');
const offline = readFileSync(resolve('public/offline.html'), 'utf8');
const origin = 'https://ri.example.test';
type Handler = (event: Record<string, unknown>) => void;

function worker() {
  const handlers: Record<string, Handler> = {};
  const cache = {
    put: vi.fn().mockResolvedValue(undefined),
    match: vi.fn().mockImplementation(async () => new Response(offline)),
  };
  const caches = {
    open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue([]), delete: vi.fn(),
  };
  const fetch = vi.fn().mockResolvedValue(new Response('online', { headers: { 'content-type': 'text/html' } }));
  const self = {
    addEventListener: (name: string, handler: Handler) => { handlers[name] = handler; },
    location: { origin },
    clients: { matchAll: vi.fn().mockResolvedValue([]), openWindow: vi.fn(), claim: vi.fn() },
    registration: { showNotification: vi.fn() },
  };
  runInNewContext(script, { self, caches, fetch, URL, Response, AbortSignal });
  return { handlers, cache, caches, fetch, self };
}

describe('installable web app manifest', () => {
  it('uses stable credential-free identity and same-origin launch URLs', () => {
    const value = manifest();
    expect(value).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });
    expect(JSON.stringify(value)).not.toMatch(/token|https?:\/\//i);
  });

  it('ships real square install icons, including an opaque safe-zone maskable image', async () => {
    const icons = manifest().icons!;
    for (const icon of icons) {
      const metadata = await sharp(resolve(`public${icon.src}`)).metadata();
      expect(`${metadata.width}x${metadata.height}`).toBe(icon.sizes);
      expect(metadata.format).toBe('png');
    }
    expect(icons.map(icon => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    const maskable = icons.find(icon => icon.purpose === 'maskable')!;
    const { data, info } = await sharp(resolve(`public${maskable.src}`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // The entire mark must survive any compliant mask: the centered circle
    // with radius 40% of image width is the guaranteed maskable safe zone.
    let markPixels = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * 4;
      expect(data[offset + 3]).toBe(255);
      if (data[offset] < 180) {
        markPixels++;
        expect(Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2)).toBeLessThan(info.width * 0.4);
      }
    }
    expect(markPixels).toBeGreaterThan(10_000);
    const apple = await sharp(resolve('src/app/apple-icon.png')).metadata();
    expect(apple.width).toBe(180);
    expect(apple.height).toBe(180);
  });
});

describe('one public offline page, never an authenticated cache', () => {
  it('installs exactly the public explanation without sending credentials', async () => {
    const w = worker();
    let done: Promise<void> | undefined;
    w.handlers.install({ waitUntil: (value: Promise<void>) => { done = value; } });
    await done;
    expect(w.fetch).toHaveBeenCalledExactlyOnceWith('/offline.html', { cache: 'reload', credentials: 'omit', signal: expect.any(AbortSignal) });
    expect(w.cache.put).toHaveBeenCalledTimes(1);
    expect(w.cache.put.mock.calls[0][0]).toBe('/offline.html');
  });

  it.each(['fetch', 'open', 'put'])('keeps push installable when optional offline %s fails', async (failure) => {
    const w = worker();
    if (failure === 'fetch') w.fetch.mockRejectedValue(new TypeError('network down'));
    else if (failure === 'open') w.caches.open.mockRejectedValue(new Error('Storage is unavailable'));
    else w.cache.put.mockRejectedValue(new DOMException('Storage quota exceeded', 'QuotaExceededError'));
    let done: Promise<void> | undefined;
    w.handlers.install({ waitUntil: (value: Promise<void>) => { done = value; } });
    await expect(done).resolves.toBeUndefined();
    w.handlers.push({ data: { json: () => ({ title: 'Task ready', url: '/?session=one' }) }, waitUntil: (value: Promise<void>) => { done = value; } });
    await done;
    expect(w.self.registration.showNotification).toHaveBeenCalledWith('Task ready', expect.any(Object));
  });

  it('activates when browser cache cleanup is unavailable', async () => {
    const w = worker();
    w.caches.keys.mockRejectedValue(new Error('Storage is unavailable'));
    let done: Promise<void> | undefined;
    w.handlers.activate({ waitUntil: (value: Promise<void>) => { done = value; } });
    await expect(done).resolves.toBeUndefined();
    expect(w.self.clients.claim).toHaveBeenCalledTimes(1);
  });

  it('preserves gateway errors when the optional offline cache cannot be read', async () => {
    const w = worker();
    w.fetch.mockResolvedValue(new Response('server updating', { status: 503 }));
    w.caches.open.mockRejectedValue(new Error('Storage is unavailable'));
    let response: Promise<Response> | undefined;
    w.handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: `${origin}/notes/private` }, respondWith: (value: Promise<Response>) => { response = value; } });
    const result = (await response)!;
    expect(result.status).toBe(503);
    expect(await result.text()).toBe('server updating');
  });

  it.each([
    ['POST', 'navigate', '/tasks'],
    ['GET', 'cors', '/api/tasks'],
    ['GET', 'navigate', '/api/attachments/private.svg'],
    ['GET', 'navigate', '/api/connectors/callback?code=secret'],
    ['GET', 'navigate', '/_next/static/chunk.js'],
    ['GET', 'navigate', 'https://external.example/'],
  ])('does not intercept %s %s %s', (method, mode, path) => {
    const w = worker();
    const respondWith = vi.fn();
    w.handlers.fetch({ request: { method, mode, url: new URL(path, origin).href }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(w.cache.put).not.toHaveBeenCalled();
  });

  it('returns normal authenticated navigation responses without caching them', async () => {
    const w = worker();
    let response: Promise<Response> | undefined;
    w.handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: `${origin}/notes/private` }, respondWith: (value: Promise<Response>) => { response = value; } });
    expect(await (await response)!.text()).toBe('online');
    expect(w.cache.put).not.toHaveBeenCalled();
    expect(w.caches.open).not.toHaveBeenCalled();
  });

  it.each(['network failure', 503, 502, 504])('shows a credential-free 503 explanation for %s', async (failure) => {
    const w = worker();
    if (typeof failure === 'number') w.fetch.mockResolvedValue(new Response('gateway down', { status: failure }));
    else w.fetch.mockRejectedValue(new TypeError('network down'));
    let response: Promise<Response> | undefined;
    w.handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: `${origin}/notes/private` }, respondWith: (value: Promise<Response>) => { response = value; } });
    const result = (await response)!;
    expect(result.status).toBe(503);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(await result.text()).toContain('Your Ri computer is out of reach');
    expect(w.cache.put).not.toHaveBeenCalled();
  });

  it('keeps other service-worker caches and deletes only retired public fallback versions', async () => {
    const w = worker();
    w.caches.keys.mockResolvedValue(['other-cache', 'ri-public-offline-v0', 'ri-public-offline-v1']);
    let done: Promise<void> | undefined;
    w.handlers.activate({ waitUntil: (value: Promise<void>) => { done = value; } });
    await done;
    expect(w.caches.delete).toHaveBeenCalledExactlyOnceWith('ri-public-offline-v0');
    expect(w.self.clients.claim).toHaveBeenCalledTimes(1);
  });
});

describe('phone notification delivery', () => {
  it.each(['javascript:alert(1)', 'https://phishing.example/', '//phishing.example/', 'https://name:password@ri.example.test/'])('cannot open an untrusted notification target: %s', async (url) => {
    const w = worker();
    let done: Promise<void> | undefined;
    w.handlers.push({ data: { json: () => ({ title: 'Task ready', url }) }, waitUntil: (value: Promise<void>) => { done = value; } });
    await done;
    expect(w.self.registration.showNotification).toHaveBeenCalledWith('Task ready', expect.objectContaining({ data: { url: `${origin}/` }, icon: '/brand/ri-web-app-192.png' }));
  });

  it('preserves same-origin deep links and does not navigate an unrelated editor', async () => {
    const w = worker();
    const editor = { url: `${origin}/notes/unsaved`, focus: vi.fn(), navigate: vi.fn() };
    w.self.clients.matchAll.mockResolvedValue([editor]);
    let done: Promise<void> | undefined;
    w.handlers.notificationclick({ notification: { close: vi.fn(), data: { url: '/tasks/ready' } }, waitUntil: (value: Promise<void>) => { done = value; } });
    await done;
    expect(editor.navigate).not.toHaveBeenCalled();
    expect(w.self.clients.openWindow).toHaveBeenCalledExactlyOnceWith(`${origin}/tasks/ready`);
  });

  it('focuses an existing matching deep link', async () => {
    const w = worker();
    const target = { url: `${origin}/tasks/ready`, focus: vi.fn() };
    w.self.clients.matchAll.mockResolvedValue([target]);
    let done: Promise<void> | undefined;
    w.handlers.notificationclick({ notification: { close: vi.fn(), data: { url: '/tasks/ready' } }, waitUntil: (value: Promise<void>) => { done = value; } });
    await done;
    expect(target.focus).toHaveBeenCalledTimes(1);
    expect(w.self.clients.openWindow).not.toHaveBeenCalled();
  });
});
