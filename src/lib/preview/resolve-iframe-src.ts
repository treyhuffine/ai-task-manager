/**
 * Reachability picker — two modes, nothing else.
 *
 * A preview is reached one of two ways:
 *   - **local**: the viewing browser is on the same machine as Ri (the
 *     Mini), so the dev server's loopback URL (`http://localhost:<port>`) is
 *     directly reachable.
 *   - **remote**: anywhere else (laptop, phone) → the active remote
 *     provider's URL (beamd / portless / manual).
 *
 * The old path-proxy (`/preview/<id>/`) and its base-tag / Set-Cookie
 * rewriting are gone: both modes embed a real, different-origin URL, so
 * there's no fidelity loss and no trust-boundary leak into Ri's origin.
 */

import type { PreviewState } from '@/lib/api/preview';

export type PreviewReachability = 'local' | 'remote';

export interface BrowserLocation {
  hostname: string;
  protocol: string; // 'http:' | 'https:'
  origin?: string;
  port?: string;
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
    | 'unsafe_url'
    | 'remote_error';      // remote provider returned an actionable error
}

function readBrowserLocation(): BrowserLocation | null {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') return null;
  return { hostname: window.location.hostname, protocol: window.location.protocol, origin: window.location.origin, port: window.location.port };
}

/** A preview may execute scripts, so it must never share Ri's own origin. */
export function safePreviewUrl(value: string, location: BrowserLocation | null = readBrowserLocation()): boolean {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const hostname = location?.hostname.includes(':') && !location.hostname.startsWith('[') ? `[${location.hostname}]` : location?.hostname;
    const origin = location?.origin ?? (location ? `${location.protocol}//${hostname}${location.port ? ':' + location.port : ''}` : null);
    return !!origin && url.origin !== new URL(origin).origin;
  } catch { return false; }
}

/** Is the viewing browser on the same host as Ri? */
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
  const mode = state?.elsewhere ? 'remote' : pickReachability(loc);
  const candidate = mode === 'local' ? state?.localUrl : state?.remoteUrl;
  if (candidate && !safePreviewUrl(candidate, loc)) return { url: null, mode, reason: 'unsafe_url' };

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
