import { trpcClient } from '@/lib/trpc/client';
import { rpcOptions } from '@/lib/trpc/request-options';
/**
 * Browser-side web-push subscribe/unsubscribe helpers for the Notifications settings UI. Client-safe
 * (no server imports) — registers the service worker, fetches the VAPID public key, subscribes, and
 * stores the subscription via the authed API client.
 */
import type { WebPushServerStatus, WebPushSubscriptionPayload } from './web-push-contract';

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
    !window.riDesktop &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Switching this Electron profile to native alerts must not leave its old
 * browser subscription active. Other browsers and phones are untouched. */
export async function removeDesktopWebPushSubscription(): Promise<void> {
  if (typeof window === 'undefined' || !window.riDesktop || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await trpcClient.notifications.webPushUnsubscribePost.mutate({body: { endpoint: sub.endpoint }});
  if (!(await sub.unsubscribe())) throw new Error('Could not remove the old browser notification subscription. Retry enabling desktop notifications.');
}

export interface BrowserPushStatus extends WebPushServerStatus {
  supported: boolean;
  permission: NotificationPermission | 'unavailable';
  localSubscription: boolean;
  expired: boolean;
}

function payload(sub: PushSubscription): WebPushSubscriptionPayload {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('This browser registration is incomplete. Turn it off here, then enable it again.');
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

/** Read-only. Never asks for permission, creates a subscription or changes preferences. */
export async function getBrowserPushStatus(): Promise<BrowserPushStatus> {
  if (!webPushSupported()) return { supported: false, permission: 'unavailable', localSubscription: false, expired: false, registered: false, channel: null };
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  let sub: PushSubscription | null = null;
  try { sub = await reg?.pushManager.getSubscription() ?? null; }
  catch (error) { if (Notification.permission !== 'denied') throw error; }
  let body: WebPushSubscriptionPayload | Record<string, never> = {};
  if (sub) { try { body = payload(sub); } catch { /* An incomplete local record needs explicit repair or removal. */ } }
  const server = await trpcClient.notifications.webPushStatusPost.mutate({body: body}, rpcOptions({ timeoutMs: 15_000 }));
  return {
    ...server, supported: true, permission: Notification.permission,
    localSubscription: !!sub, expired: !!sub?.expirationTime && sub.expirationTime <= Date.now(),
  };
}

/** A local browser object alone does not prove Ri can send notifications. */
export async function isWebPushSubscribed(): Promise<boolean> {
  const status = await getBrowserPushStatus();
  return status.permission === 'granted' && status.localSubscription && !status.expired && status.registered && !!status.channel?.enabled;
}

/** Explicit enable/repair only. Existing subscriptions and channel preferences are preserved. */
export async function subscribeToWebPush(): Promise<void> {
  if (!webPushSupported()) throw new Error('Web push is not supported in this browser.');
  if (Notification.permission === 'denied') throw new Error('Notifications are blocked. Allow them in your browser settings, then check again.');
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted. Allow notifications in your browser settings and try again.');

  const reg = await navigator.serviceWorker.register(SW_URL);
  await waitForActiveWorker(reg);
  let sub = await reg.pushManager.getSubscription();
  if (sub?.expirationTime && sub.expirationTime <= Date.now()) {
    if (!(await sub.unsubscribe())) throw new Error('Could not replace the expired browser registration. Try repairing it again.');
    sub = null;
  }
  if (!sub) {
    const { publicKey } = await trpcClient.notifications.webPushPublicKeyGet.query({}, rpcOptions({ timeoutMs: 15_000 }));
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  }
  // Keep an unacknowledged local subscription available for explicit repair.
  // The status reader will never report it as registered until the server agrees.
  const registration = payload(sub);
  try { await trpcClient.notifications.webPushSubscribePost.mutate({body: registration}, rpcOptions({ timeoutMs: 15_000 })); }
  catch { throw new Error('Ri could not confirm this browser registration. Reconnect to Ri and choose Repair browser notifications.'); }
}

/** Delete the server record before the local handle so failure remains retryable. */
export async function unsubscribeFromWebPush(): Promise<void> {
  if (!webPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  try { await trpcClient.notifications.webPushUnsubscribePost.mutate({body: { endpoint: sub.endpoint }}, rpcOptions({ timeoutMs: 15_000 })); }
  catch { throw new Error('Ri could not turn off notifications for this browser. Reconnect and retry Turn off here.'); }
  try {
    if (!(await sub.unsubscribe())) throw new Error('Browser refused to remove the subscription');
  } catch {
    throw new Error('Ri has stopped sending here, but this browser could not remove its registration. Retry Turn off here.');
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
