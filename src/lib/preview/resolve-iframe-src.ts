/**
 * Pick the right URL for the preview iframe — direct embed of the dev
 * server's native URL when the browser can reach it, path-based proxy
 * fallback otherwise.
 *
 * Why both: the path proxy (`/preview/<id>/`) works from any browser
 * that can reach Flow, but at a fidelity cost — root-absolute paths
 * (`/fonts/x.otf`), cross-origin manifest URLs, and apps with baked-in
 * absolute origins all break or degrade. Direct embedding fixes all of
 * that, but only works when the browser can resolve and reach the dev
 * server's native URL.
 *
 * Reachability heuristics, by where the browser is:
 *
 *   - **Same machine as Flow** (`localhost`, `127.0.0.1`, `*.localhost`):
 *     The browser natively resolves `*.localhost` to 127.0.0.1 (RFC 6761),
 *     so a Portless route `https://<name>.localhost` is reachable. A bare
 *     command-mode dev server at `http://localhost:<port>` is reachable.
 *     Pick direct.
 *
 *   - **Same tailnet** (`*.ts.net`): Tailscale's MagicDNS plus the per-
 *     app Tailscale URL (`route.tailscaleUrl`) gives a real reachable
 *     HTTPS origin. If the workspace has a Portless route that was
 *     started with `--tailscale`, pick that.
 *
 *   - **Anything else** (ngrok, LAN IP, custom domain, etc.): we can't
 *     prove the browser can reach the dev server's native URL, so use
 *     the proxy. Degraded but at least loads something for complex apps.
 *
 * Mixed-content guard: if Flow is HTTPS and the candidate direct URL
 * is HTTP, browsers block the iframe. We detect this and fall back to
 * the proxy in that case — better a degraded page than a blank one.
 */

import type { AppPreviewStatusResponse } from '@/lib/api/workspaces';

export type IframeSrcMode = 'direct' | 'proxy';

export interface ResolveIframeSrcOptions {
  workspaceId: string;
  status: AppPreviewStatusResponse;
  /**
   * Path-proxy URL the resolver returns when direct embedding isn't
   * reachable. Usually `/preview/<id>/?_pt=<token>` (the token is
   * appended by the caller, not us).
   */
  pathProxyUrl: string;
  /** The window the iframe will be hosted in. Defaults to globalThis.window. */
  browserLocation?: BrowserLocation | null;
}

export interface BrowserLocation {
  hostname: string;
  protocol: string;  // 'http:' | 'https:'
}

export interface ResolvedIframeSrc {
  url: string;
  mode: IframeSrcMode;
  /** Human-readable reason for the choice, surfaced in dev console / UI tooltips. */
  reason:
    | 'no_status'
    | 'not_running'
    | 'local_portless'
    | 'local_command'
    | 'tailnet_direct'
    | 'mixed_content'
    | 'no_reachable_direct';
}

function readBrowserLocation(): BrowserLocation | null {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') return null;
  return { hostname: window.location.hostname, protocol: window.location.protocol };
}

export function resolveIframeSrc(options: ResolveIframeSrcOptions): ResolvedIframeSrc {
  const { status, pathProxyUrl } = options;
  const loc = options.browserLocation === undefined ? readBrowserLocation() : options.browserLocation;

  // 1. Always require status + a port to attempt direct embedding.
  if (!status) {
    return { url: pathProxyUrl, mode: 'proxy', reason: 'no_status' };
  }
  if (status.status !== 'running' || !status.port) {
    return { url: pathProxyUrl, mode: 'proxy', reason: 'not_running' };
  }
  if (!loc) {
    // SSR or test environment without a window. Path proxy is the safe
    // default — it always works through Flow's origin.
    return { url: pathProxyUrl, mode: 'proxy', reason: 'no_reachable_direct' };
  }

  const hostname = loc.hostname.toLowerCase();
  const flowIsHttps = loc.protocol === 'https:';

  // 2. Local browser: prefer the dev server's loopback-resolvable URL.
  if (isLocalHostname(hostname)) {
    if (status.mode === 'portless' && status.hostname) {
      const direct = `https://${status.hostname}.localhost`;
      return { url: direct, mode: 'direct', reason: 'local_portless' };
    }
    if (status.mode === 'command' && status.port) {
      const direct = `http://localhost:${status.port}`;
      // HTTPS Flow embedding HTTP iframe → mixed-content blocked.
      // Unusual locally (Flow is usually HTTP), but possible if the
      // user fronts Flow with TLS termination.
      if (flowIsHttps) {
        return { url: pathProxyUrl, mode: 'proxy', reason: 'mixed_content' };
      }
      return { url: direct, mode: 'direct', reason: 'local_command' };
    }
  }

  // 3. Tailnet browser: prefer the per-app Tailscale URL if Portless
  //    registered one. Real cert, real DNS, full app fidelity.
  if (hostname.endsWith('.ts.net') && status.tailscaleUrl) {
    const direct = status.tailscaleUrl;
    // Tailscale URLs are HTTPS by default. If the recorded URL is HTTP
    // and Flow is HTTPS, fall back to avoid mixed content.
    if (flowIsHttps && direct.startsWith('http://')) {
      return { url: pathProxyUrl, mode: 'proxy', reason: 'mixed_content' };
    }
    return { url: direct, mode: 'direct', reason: 'tailnet_direct' };
  }

  // 4. Nothing else is reliably reachable directly. Use the path proxy.
  return { url: pathProxyUrl, mode: 'proxy', reason: 'no_reachable_direct' };
}

function isLocalHostname(h: string): boolean {
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (h.endsWith('.localhost')) return true;
  return false;
}
