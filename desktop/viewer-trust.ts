import { sameOrigin } from './trust';
import type { BackendReady } from './config';
import type { DesktopNotificationAction } from '../src/lib/notifications/desktop-contract';

/** The viewer URL never establishes local privilege. Only a pinned local
 * service session may supply its private native capability. */
export function isLocalViewer(ready: BackendReady) {
  return ready.connection !== 'remote' && !!ready.desktopClient && (!!ready.certificate || isLocalPlainHome(ready.origin));
}

export function trustedViewerFrame(input: { senderId: number; windowId?: number; mainFrame: boolean; url: string; origin?: string }) {
  return input.senderId === input.windowId && input.mainFrame && !!input.origin && sameOrigin(input.url, input.origin);
}

/** The notification actions a viewer may ask for. A connected Home's renderer may ask, never grant:
 * its changes go through `remoteNotificationChanges`, where only the person's native answer enables. */
export function viewerNotificationAction(action: unknown): DesktopNotificationAction {
  if (typeof action !== 'string' || !['status', 'enable', 'disable', 'test'].includes(action)) throw new Error('Invalid notification action');
  return action as DesktopNotificationAction;
}

export function remoteViewerOrigin(raw: string, development = false) {
  const url = new URL(raw);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(development && loopback && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('A remote Ri must use HTTPS. Loopback HTTP is allowed only in development.');
  }
  return url.origin;
}


/** This app implements bridge 1. A Home's pages may need a newer one, local or
 * elsewhere (docs/always-on-spec.md 4.2). An older Home that doesn't say has bridge 1. */
export function assertBridge(nativeBridge?: number[]) {
  if (nativeBridge && !nativeBridge.includes(1)) throw Object.assign(new Error('This Ri needs a newer desktop app than this one.'), { problem: 'app_update' });
}

/** A Home on this computer serving plain HTTP, kept from a terminal (section 10.3).
 * Loopback only, so there's nothing for a certificate to protect. */
export function isLocalPlainHome(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

/** The Electron viewer uses Ri's main-process notification pipeline, including
 * this device's local presentation consent. Chromium notifications must never
 * become a second path around it. Browser tabs retain their browser policy.
 * Microphone, clipboard writes and fullscreen belong only to the actual main
 * document, never a same-origin embedded preview or a service worker. */
export function viewerPermission(input: {
  permission: string;
  senderId?: number;
  windowId?: number;
  isMainFrame?: boolean;
  requestingUrl?: string;
  origin: string;
}): boolean {
  if (input.senderId === undefined || input.windowId === undefined || input.senderId !== input.windowId || input.isMainFrame !== true) return false;
  if (!input.requestingUrl || !sameOrigin(input.requestingUrl, input.origin)) return false;
  return ['media', 'clipboard-sanitized-write', 'fullscreen'].includes(input.permission);
}

/** A renderer reload of the exact current trusted document keeps Chromium's
 * own beforeunload gate. Re-running the asynchronous navigation save guard
 * would reject an explicit API-upgrade reload that just retained its drafts.
 * Changed URLs still require the ordinary navigation handshake. */
export function isViewerReload(target: string, current: string, origin: string): boolean {
  return target === current && sameOrigin(target, origin);
}
