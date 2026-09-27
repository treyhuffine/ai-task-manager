/**
 * Notifier web-push service worker (docs/connectors-email-and-notifier-spec.md §2.11).
 * Renders incoming pushes and deep-links on click. Payload: { title, body, url }.
 * The only cached response is a fixed public connection-help page. Never cache
 * application pages, API responses, attachments, credentials, or mutations.
 */
const OFFLINE_CACHE = 'ri-public-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const response = await fetch(OFFLINE_URL, { cache: 'reload', credentials: 'omit', signal: AbortSignal.timeout(5000) });
      if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes('text/html')) return;
      const cache = await caches.open(OFFLINE_CACHE);
      await cache.put(OFFLINE_URL, response);
    } catch { /* Optional offline help must not prevent push from activating. */ }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      for (const key of await caches.keys()) {
        if (key.startsWith('ri-public-offline-') && key !== OFFLINE_CACHE) await caches.delete(key);
      }
    } catch { /* Browser storage can be denied or unavailable. */ }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // API and framework documents must preserve their error/response semantics,
  // even when someone opens their URL directly in a browser tab.
  if (request.method !== 'GET' || request.mode !== 'navigate' || url.origin !== self.location.origin ||
      /^\/(api|_next)(\/|$)/.test(url.pathname)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (![502, 503, 504].includes(response.status)) return response;
      const fallback = await offlineResponse();
      return fallback ?? response;
    } catch (error) {
      const fallback = await offlineResponse();
      if (fallback) return fallback;
      throw error;
    }
  })());
});

async function offlineResponse() {
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    const response = await cache.match(OFFLINE_URL);
    if (!response) return undefined;
    return new Response(response.body, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch { return undefined; }
}

function notificationUrl(raw) {
  try {
    const url = new URL(typeof raw === 'string' ? raw : '/', self.location.origin);
    // A notification cannot navigate an existing authenticated Ri tab to an
    // external origin or an active URL scheme, even with a malformed payload.
    if (url.origin === self.location.origin && !url.username && !url.password) return url.href;
  } catch { /* Fall back to the app root. */ }
  return `${self.location.origin}/`;
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  if (!data || typeof data !== 'object') data = {};
  const title = typeof data.title === 'string' && data.title ? data.title : 'Ri';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    data: { url: notificationUrl(data.url) },
    icon: '/brand/ri-web-app-192.png',
    badge: '/brand/ri-notification-badge.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = notificationUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url === url && 'focus' in client) {
          await client.focus();
          return;
        }
      }
      // Do not navigate an unrelated open editor and discard unsent work.
      if (self.clients.openWindow && url) await self.clients.openWindow(url);
    })(),
  );
});
