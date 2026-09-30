import { sameOrigin } from './trust';
import type { BackendReady } from './config';

/** The viewer URL never establishes local privilege. Only a pinned local
 * service session may supply its private native capability. */
export function isLocalViewer(ready: BackendReady) {
  return ready.connection !== 'remote' && !!ready.desktopClient && !!ready.certificate;
}

export function trustedViewerFrame(input: { senderId: number; windowId?: number; mainFrame: boolean; url: string; origin?: string }) {
  return input.senderId === input.windowId && input.mainFrame && !!input.origin && sameOrigin(input.url, input.origin);
}

export function remoteViewerOrigin(raw: string, development = false) {
  const url = new URL(raw);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(development && loopback && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('A remote Home must use HTTPS. Loopback HTTP is allowed only in development.');
  }
  return url.origin;
}


/** Existing local desktop releases implement bridge 1. New runtimes must
 * explicitly keep that bridge or tell this shell to update before opening it. */
export function assertLocalBridge(peer?: { compatibility: { nativeBridge: number[] } }) {
  if (peer && !peer.compatibility.nativeBridge.includes(1)) throw new Error('Update the Ri desktop app on this device before opening this Home runtime. Its native bridge is incompatible.');
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
