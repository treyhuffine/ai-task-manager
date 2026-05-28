/**
 * Auth helper for the `/preview/<workspace>/*` proxy route.
 *
 * The proxy lives outside the `/api/*` middleware matcher, so it does
 * its own auth in the route handler. Three transports are accepted, in
 * order of preference:
 *
 *   1. Per-workspace preview cookie (`flow_preview_<id>`) — set on a
 *      previous request. The cookie's value is the same opaque token
 *      the supervisor minted, but scoped to `/preview/<id>/` and short-
 *      lived so it doesn't outlive the preview process.
 *
 *   2. `_pt=<token>` query param — the iframe's initial src includes
 *      this. On success we drop the per-workspace cookie so subsequent
 *      same-iframe loads (relative `<img>`, `<script>`, fetches) work
 *      without the query string.
 *
 *   3. Standard Flow auth — the session cookie or `Authorization`
 *      Bearer header, the same way every other route authenticates.
 *      Used for direct navigation in a browser tab the user already
 *      logged into.
 *
 * The point of transports (1) and (2) is to give the iframe a way to
 * authenticate without inheriting the parent's account credentials —
 * the preview token is workspace-scoped and rotates whenever the
 * preview process restarts.
 */

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { hashToken } from '@/lib/auth/tokens';
import { findApiKeyByHash } from '@/lib/db/queries';

export const PREVIEW_QUERY_TOKEN = '_pt';

export function previewCookieName(workspaceId: string): string {
  // Cookie names can't include some chars (semicolons, etc.). Workspace
  // ids are UUIDv7 so they're safe; this is documentation, not sanitization.
  return `flow_preview_${workspaceId}`;
}

export type PreviewAuthResult =
  | { ok: true; via: 'preview_cookie' | 'preview_query' | 'session' }
  | { ok: false; reason: 'no_credentials' | 'invalid' };

/**
 * Run the preview-route auth check. The supervisor's `isTokenValid`
 * is delegated in (rather than imported) so this module can be tested
 * without spinning up a supervisor.
 */
export function checkPreviewAuth(
  request: NextRequest,
  workspaceId: string,
  isPreviewTokenValid: (token: string) => boolean,
): PreviewAuthResult {
  // (1) Per-workspace preview cookie
  const cookieName = previewCookieName(workspaceId);
  const previewCookie = request.cookies.get(cookieName);
  if (previewCookie?.value && isPreviewTokenValid(previewCookie.value)) {
    return { ok: true, via: 'preview_cookie' };
  }

  // (2) `_pt` query param
  const queryToken = request.nextUrl.searchParams.get(PREVIEW_QUERY_TOKEN);
  if (queryToken && isPreviewTokenValid(queryToken)) {
    return { ok: true, via: 'preview_query' };
  }

  // (3) Standard Flow auth — bearer header wins, else the session cookie.
  const authHeader = request.headers.get('authorization');
  let flowToken: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) flowToken = t;
  }
  if (!flowToken) {
    const session = request.cookies.get(SESSION_COOKIE_NAME);
    if (session?.value) flowToken = session.value;
  }
  if (!flowToken) return { ok: false, reason: 'no_credentials' };

  try {
    const key = findApiKeyByHash(hashToken(flowToken));
    if (!key || key.revokedAt) return { ok: false, reason: 'invalid' };
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, via: 'session' };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/** Cookie attributes for the per-workspace preview cookie. */
export function buildPreviewCookieValue(
  workspaceId: string,
  token: string,
  request: NextRequest,
): {
  name: string;
  value: string;
  path: string;
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  maxAge: number;
} {
  return {
    name: previewCookieName(workspaceId),
    value: token,
    path: `/preview/${workspaceId}/`,
    httpOnly: true,
    sameSite: 'lax',
    // Honor the actual scheme — Tailscale Serve / ngrok front the server
    // with HTTPS, plain `pnpm dev` is HTTP. Mismatch = browser drops cookie.
    secure: request.nextUrl.protocol === 'https:',
    // 1h is plenty: the supervisor rotates this token on every (re)start
    // and the iframe re-mints via `?_pt=` on remount. A long Max-Age
    // mostly creates risk (cookie outliving the token it represents)
    // without buying anything — preview sessions are interactive, not
    // long-lived background activity.
    maxAge: 60 * 60,
  };
}
