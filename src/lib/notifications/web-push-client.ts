/**
 * Browser-side web-push subscribe/unsubscribe helpers for the Notifications settings UI. Client-safe
 * (no server imports) — registers the service worker, fetches the VAPID public key, subscribes, and
 * stores the subscription via the authed API client.
 */
import { api } from '@/lib/api/client';

const SW_URL = '/notifications-sw.js';

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
  await navigator.serviceWorker.ready;

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
