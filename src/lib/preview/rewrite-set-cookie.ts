/**
 * Outbound Set-Cookie rewriter for the preview proxy.
 *
 * The dev server is on Flow's own origin (we proxy it). Without
 * intervention, any cookie it sets becomes a first-class cookie of
 * Flow's origin and fires on every Flow request — including `/api/*`.
 *
 * That has two unacceptable consequences:
 *
 *   1. **Auth disruption.** A dev app's HTML/JS can set
 *      `flow_session=arbitrary; Path=/`. The browser stores it on the
 *      Flow origin, every subsequent `/api/*` request carries it, the
 *      auth middleware rejects it, the user is silently logged out.
 *      The dev app needs no privileges to do this — it's a regular
 *      `Set-Cookie` response header.
 *
 *   2. **Cookie pollution.** A dev app's analytics / session / consent
 *      cookies are scoped to Flow's whole origin, surfacing on Flow's
 *      own pages and routes. Confusing at best, an exfiltration vector
 *      at worst.
 *
 * Fixes, applied to every outbound Set-Cookie in order:
 *
 *   - **Drop reserved names.** If the cookie name matches Flow's
 *     session cookie (`flow_session`) or our per-workspace preview
 *     cookie pattern (`flow_preview_*`), drop the header entirely.
 *     The dev server has no legitimate reason to set these, and a
 *     malicious one shouldn't be able to.
 *   - **Force Path scoping.** Replace any `Path=` attribute with
 *     `Path=/preview/<workspace-id>/`. The cookie now only fires on
 *     subsequent preview requests for THIS workspace, never on
 *     `/api/*` or any other Flow path.
 *   - **Drop `Domain=`.** Already done by the caller — kept here too
 *     for redundancy so this module is correct in isolation.
 *
 * The rewriter is byte-level and conservative. It doesn't try to
 * fully parse RFC 6265 cookies (impossible without ambiguity); it
 * splits on `;`, edits known attributes, leaves everything else alone.
 */

import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

const PREVIEW_COOKIE_PREFIX = 'flow_preview_';

interface RewriteOptions {
  workspaceId: string;
}

/**
 * Rewrite a single Set-Cookie header value.
 *
 * Returns `null` to indicate the cookie should be dropped (reserved
 * name); otherwise returns the rewritten header value to forward.
 */
export function rewriteSetCookie(raw: string, opts: RewriteOptions): string | null {
  const parts = raw.split(/;\s*/);
  if (parts.length === 0) return null;

  // First segment is `name=value`. Pull the name and reject reserved
  // ones outright.
  const nameValue = parts[0];
  const eqIdx = nameValue.indexOf('=');
  const name = eqIdx >= 0 ? nameValue.slice(0, eqIdx).trim() : nameValue.trim();
  if (isReservedCookieName(name)) {
    return null;
  }

  // Rebuild the cookie with rewritten attributes. Attribute matching
  // is case-insensitive per RFC 6265.
  const rebuilt: string[] = [nameValue];
  let sawPath = false;
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i];
    if (!segment) continue;
    const seg = segment.trim();
    if (!seg) continue;
    const lower = seg.toLowerCase();

    if (lower === 'domain' || lower.startsWith('domain=')) {
      // Always drop Domain — we want the cookie scoped to Flow's origin.
      continue;
    }
    if (lower === 'path' || lower.startsWith('path=')) {
      // Rewrite (don't preserve the upstream's path).
      sawPath = true;
      rebuilt.push(`Path=${pathForWorkspace(opts.workspaceId)}`);
      continue;
    }
    rebuilt.push(seg);
  }
  if (!sawPath) {
    rebuilt.push(`Path=${pathForWorkspace(opts.workspaceId)}`);
  }
  return rebuilt.join('; ');
}

/**
 * Rewrite an array of Set-Cookie header values. Drops entries that
 * `rewriteSetCookie` rejects.
 */
export function rewriteSetCookieList(headers: ReadonlyArray<string>, opts: RewriteOptions): string[] {
  const out: string[] = [];
  for (const raw of headers) {
    const next = rewriteSetCookie(raw, opts);
    if (next !== null) out.push(next);
  }
  return out;
}

function pathForWorkspace(workspaceId: string): string {
  // Workspace ids are UUIDv7 — alphanumeric + dashes — so they pass
  // through path attribute syntax cleanly. Defense-in-depth: refuse
  // anything weird so we never end up with a path attr containing `;`
  // or `,` that would break the rewritten cookie.
  if (!/^[A-Za-z0-9_-]+$/.test(workspaceId)) {
    // Fall back to a path that won't fire anywhere usable rather than
    // emit a malformed cookie that some browsers would discard.
    return '/preview/__invalid__/';
  }
  return `/preview/${workspaceId}/`;
}

/**
 * Cookie names the dev server is NEVER allowed to set. Matches:
 *   - Flow's session cookie (exactly).
 *   - Any `flow_preview_*` cookie (per-workspace preview tokens).
 *
 * Both are case-sensitive — cookie names are case-sensitive per
 * browser behavior, even though attributes are not.
 */
export function isReservedCookieName(name: string): boolean {
  if (name === SESSION_COOKIE_NAME) return true;
  if (name.startsWith(PREVIEW_COOKIE_PREFIX)) return true;
  return false;
}
