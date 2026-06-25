/**
 * Notifier web-push service worker (docs/connectors-email-and-notifier-spec.md §2.11).
 * Renders incoming pushes and deep-links on click. Payload: { title, body, url }.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Notification';
  const options = {
    body: data.body || '',
    data: { url: data.url || '/' },
    icon: '/window.svg',
    badge: '/window.svg',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          if (url && 'navigate' in client) {
            try {
              await client.navigate(url);
            } catch {
              /* cross-origin or not allowed — focus is enough */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow && url) await self.clients.openWindow(url);
    })(),
  );
});
