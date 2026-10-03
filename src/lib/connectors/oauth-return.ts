import { NextResponse } from 'next/server';

/**
 * Where an OAuth callback lands the browser once the exchange is done.
 *
 * The callback cannot use its own origin. Next builds `request.url` from the
 * address it is bound to, so a callback that arrived through a tunnel (beamd)
 * or the HTTP/2 gateway still reads `localhost`, and bouncing there strands a
 * phone on an address it cannot reach. The callback origin is also not always
 * the page's origin: the provider sends the browser to the registered redirect
 * URI, which can be the tunnel while the user is on localhost, or an older
 * tunnel name that a saved OAuth app still carries.
 *
 * So the route that starts a sign-in records the page's origin (and an
 * optional in-app path) against the OAuth `state`, and the callback returns
 * there. When nothing was recorded (a restart mid-flow, or a sign-in link an
 * agent handed out) the callback answers with a relative Location, which keeps
 * the browser on whatever origin it reached the callback through.
 */

export const DEFAULT_OAUTH_RETURN_PATH = '/?settings=plugins';

/** The engine's auth-request lifetime (and the MCP state's): past it the callback fails anyway. */
const TTL_MS = 10 * 60_000;

interface OAuthReturn {
  /** The page origin that started the sign-in, or null when it could not be trusted. */
  origin: string | null;
  path: string;
  expiresAt: number;
}

// Route handlers can each load their own copy of this module, so the pending
// returns live on globalThis to be shared between the connect and callback routes.
const g = globalThis as typeof globalThis & { __riOAuthReturns?: Map<string, OAuthReturn> };
const pending = (g.__riOAuthReturns ??= new Map());

/**
 * The origin of the page that sent this request, when the browser vouches for it.
 * `Sec-Fetch-Site: same-origin` means the page and this endpoint share one origin,
 * so `Origin` names an address the app is actually served from. A request that
 * does not say (CLI, older browser) or comes from elsewhere records no origin.
 */
export function pageOrigin(request: Pick<Request, 'headers' | 'url'>): string | null {
  if (request.headers.get('sec-fetch-site') !== 'same-origin') return null;
  const origin = request.headers.get('origin');
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

// Stands in for the app's origin while a path is resolved, so the result can be
// checked for having left it.
const IN_APP = 'http://ri.invalid';

/**
 * Resolve a path the way a browser will, and keep it only if it stays in the app.
 * Checking the raw string is not enough: `/\host` is read as `//host`, and dot
 * segments normalize `/a/..//host` to `//host`, both protocol-relative. Null when
 * the path would leave the app's origin or resolves to `//...`.
 */
function resolveInApp(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw, IN_APP);
  } catch {
    return null;
  }
  if (url.origin !== IN_APP || url.pathname.startsWith('//')) return null;
  return url;
}

/**
 * An in-app path the callback may land on, normalized, or null. Same-origin
 * paths only: never another host, whether written `//host`, `/\host` or through
 * dot segments.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return null;
  const url = resolveInApp(raw);
  return url ? `${url.pathname}${url.search}${url.hash}` : null;
}

/** Record where the sign-in behind `state` should come back to. */
export function rememberOAuthReturn(state: string, request: Pick<Request, 'headers' | 'url'>, path?: string | null, now = Date.now()): void {
  for (const [key, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(key);
  }
  pending.set(state, {
    origin: pageOrigin(request),
    path: safeReturnPath(path) ?? DEFAULT_OAUTH_RETURN_PATH,
    expiresAt: now + TTL_MS,
  });
}

/** The recorded return for `state`, removed on read. Null when unknown or expired. */
export function takeOAuthReturn(state: string | null, now = Date.now()): { origin: string | null; path: string } | null {
  if (!state) return null;
  const entry = pending.get(state);
  if (!entry) return null;
  pending.delete(state);
  return entry.expiresAt > now ? { origin: entry.origin, path: entry.path } : null;
}

/**
 * A redirect back into the app with the result query (`connected` / `error`).
 * Absolute when the starting origin is known, relative otherwise.
 */
export function oauthReturnRedirect(
  target: { origin: string | null; path: string } | null,
  result: Record<string, string>,
): Response {
  // Re-checked here, not only when recorded, so no caller can hand in a path that leaves the app.
  const url = resolveInApp(target?.path ?? DEFAULT_OAUTH_RETURN_PATH) ?? new URL(DEFAULT_OAUTH_RETURN_PATH, IN_APP);
  for (const [key, value] of Object.entries(result)) url.searchParams.set(key, value);
  const location = `${url.pathname}${url.search}${url.hash}`;
  if (target?.origin) return NextResponse.redirect(new URL(location, target.origin));
  return new Response(null, { status: 307, headers: { Location: location } });
}
