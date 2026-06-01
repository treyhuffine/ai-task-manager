/**
 * Reachability picker — two modes, nothing else.
 *
 * A preview is reached one of two ways:
 *   - **local**: the viewing browser is on the same machine as Flow (the
 *     Mini), so the dev server's loopback URL (`http://localhost:<port>`) is
 *     directly reachable.
 *   - **remote**: anywhere else (laptop, phone) → the active remote
 *     provider's URL (beamd / portless / manual).
 *
 * The old path-proxy (`/preview/<id>/`) and its base-tag / Set-Cookie
 * rewriting are gone: both modes embed a real, different-origin URL, so
 * there's no fidelity loss and no trust-boundary leak into Flow's origin.
 */

import type { PreviewState } from '@/lib/api/preview';

export type PreviewReachability = 'local' | 'remote';

export interface BrowserLocation {
  hostname: string;
  protocol: string; // 'http:' | 'https:'
}

export interface ResolvedPreviewSrc {
  /** The URL to embed, or null when nothing is reachable yet. */
  url: string | null;
  mode: PreviewReachability;
  reason:
    | 'local'              // loopback URL, viewer is on the Mini
    | 'remote'             // active remote provider URL
    | 'not_running'        // server isn't up (local) — nothing to embed
    | 'no_local_url'       // local viewer but no loopback URL yet
    | 'no_remote_url'      // remote viewer but the provider hasn't resolved a URL
    | 'remote_error';      // remote provider returned an actionable error
}

function readBrowserLocation(): BrowserLocation | null {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') return null;
  return { hostname: window.location.hostname, protocol: window.location.protocol };
}

/** Is the viewing browser on the same host as Flow? */
export function isLocalViewer(loc: BrowserLocation | null = readBrowserLocation()): boolean {
  if (!loc) return false;
  const h = loc.hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

/** Which mode the current viewer needs. Drives the `remote` flag on start. */
export function pickReachability(loc?: BrowserLocation | null): PreviewReachability {
  const location = loc === undefined ? readBrowserLocation() : loc;
  return isLocalViewer(location) ? 'local' : 'remote';
}

/**
 * Pick the URL to embed for the current viewer from a resolved preview
 * state. Pure — pass `browserLocation` in tests.
 */
export function resolvePreviewSrc(
  state: PreviewState | null,
  browserLocation?: BrowserLocation | null,
): ResolvedPreviewSrc {
  const loc = browserLocation === undefined ? readBrowserLocation() : browserLocation;
  const mode = pickReachability(loc);

  if (mode === 'local') {
    if (state?.localUrl) return { url: state.localUrl, mode, reason: 'local' };
    if (state && state.serverStatus !== 'running') return { url: null, mode, reason: 'not_running' };
    return { url: null, mode, reason: 'no_local_url' };
  }

  // remote
  if (state?.remoteUrl) return { url: state.remoteUrl, mode, reason: 'remote' };
  if (state?.remoteError) return { url: null, mode, reason: 'remote_error' };
  return { url: null, mode, reason: 'no_remote_url' };
}
