/**
 * Browser-side web-push subscribe/unsubscribe helpers for the Notifications settings UI. Client-safe
 * (no server imports) — registers the service worker, fetches the VAPID public key, subscribes, and
 * stores the subscription via the authed API client.
 */
import { api } from '@/lib/api/client';

const SW_URL = '/notifications-sw.js';

/** `serviceWorker.ready` never rejects. Observe this registration instead so
 * a failed or stalled installation returns an actionable settings error. */
function waitForActiveWorker(reg: ServiceWorkerRegistration): Promise<void> {
  return new Promise((resolve, reject) => {
    const observed = new Set<ServiceWorker>();
    const finish = (error?: Error) => {
      clearTimeout(timer);
      reg.removeEventListener('updatefound', inspect);
      for (const worker of observed) worker.removeEventListener('statechange', inspect);
      if (error) reject(error); else resolve();
    };
    const inspect = () => {
      if (reg.active?.state === 'activated') { finish(); return; }
      const worker = reg.installing ?? reg.waiting ?? reg.active;
      if (!worker) return;
      if (worker.state === 'redundant') {
        finish(new Error('Notification setup failed. Reload Ri and try enabling notifications again.'));
        return;
      }
      if (!observed.has(worker)) {
        observed.add(worker);
        worker.addEventListener('statechange', inspect);
      }
    };
    const timer = setTimeout(() => finish(new Error('Notification setup timed out. Check your connection, reload Ri and try again.')), 15_000);
    reg.addEventListener('updatefound', inspect);
    inspect();
  });
}

export function webPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** True if this browser currently has an active push subscription. */
export async function isWebPushSubscribed(): Promise<boolean> {
  if (!webPushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  return !!(await reg?.pushManager.getSubscription());
}

/** Request permission, subscribe this browser, and persist it. Throws on denial/unsupported. */
export async function subscribeToWebPush(): Promise<void> {
  if (!webPushSupported()) throw new Error('Web push is not supported in this browser.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was denied.');

  const reg = await navigator.serviceWorker.register(SW_URL);
  await waitForActiveWorker(reg);

  const { publicKey } = await api.get<{ publicKey: string }>('/notifications/web-push/public-key');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = sub.toJSON();
  await api.post('/notifications/web-push/subscribe', { endpoint: json.endpoint, keys: json.keys });
}

/** Remove this browser's subscription (server + local). */
export async function unsubscribeFromWebPush(): Promise<void> {
  if (!webPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.post('/notifications/web-push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
