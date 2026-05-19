/**
 * Reverse proxy for a workspace's dev server.
 *
 * Mounted at `/preview/<workspace-id>/<subpath>` on Flow's own origin.
 * The execution view's preview pane iframes `/preview/<id>/`; the iframe's
 * relative resource loads cascade through here.
 *
 *   Browser  ─►  GET /preview/<id>/<subpath>
 *                  │  auth check (preview cookie / _pt / Flow session)
 *                  │  upstream port from supervisor (or Portless, P5)
 *                  ▼
 *               fetch http://127.0.0.1:<port>/<subpath>
 *                  │  body streamed back
 *                  │  HTML responses get a <base href="/preview/<id>/"> tag
 *                  ▼
 *   Browser  ◄─  response
 *
 * WebSocket upgrades return 502 in v1 (`preview_websocket_unsupported`)
 * — HMR is out of scope per the spec. The connection failure is loud,
 * so users see "preview won't auto-refresh" rather than a silent stall.
 *
 * Phase 5 will add a Portless branch (route lookup from ~/.portless/
 * routes.json + Host header overwrite). Until then this only handles
 * Command mode.
 */

import { type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { getSupervisor } from '@/lib/preview/supervisor';
import {
  checkPreviewAuth,
  buildPreviewCookieValue,
  previewCookieName,
  PREVIEW_QUERY_TOKEN,
} from '@/lib/preview/auth';
import { createBaseTagInjector } from '@/lib/preview/inject-base';
import { rewriteSetCookieList } from '@/lib/preview/rewrite-set-cookie';
import { getWorkspace, resolveWorkspacePreviewMode } from '@/lib/db/queries';
import { derivePortlessHostname, findRoute } from '@/lib/preview/portless';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Headers we strip from the *inbound* request before forwarding. */
const STRIP_INBOUND = new Set([
  ...HOP_BY_HOP,
  // Don't leak Flow's own bearer to the upstream dev server.
  'authorization',
  // Cookies are filtered to remove our preview/session cookies below.
  'cookie',
  'host',
  'content-length',
]);

/** Headers we strip from the *outbound* response before mirroring. */
const STRIP_OUTBOUND = new Set([
  ...HOP_BY_HOP,
  // Length will be re-encoded by Node's fetch on chunked streams; trying
  // to pass through can lead to "content-length mismatch" errors.
  'content-length',
  'content-encoding',
]);

async function handle(
  request: NextRequest,
  { params }: { params: Promise<{ workspace: string; path?: string[] }> },
): Promise<Response> {
  const { workspace: workspaceId, path: pathSegments = [] } = await params;

  if (!workspaceId) {
    return badRequest('preview_no_workspace', 'No workspace specified.');
  }

  // Workspace must exist (so we can resolve mode + cwd later). For pure
  // Command mode this is mostly defense-in-depth — but it also gives us
  // an early 404 instead of a confusing 503 when the URL is wrong.
  const ws = getWorkspace(workspaceId);
  if (!ws) return notFound('preview_workspace_not_found', `Workspace not found: ${workspaceId}`);

  // --- Mode resolution -----------------------------------------
  const mode = resolveWorkspacePreviewMode(ws);

  // --- Auth -----------------------------------------------------
  // Both modes accept the same auth transports. The preview token gate
  // is supervisor-bound; in Portless mode no token is minted, so iframes
  // authenticate via the standard Flow session cookie. This is fine
  // because the parent page (Flow UI) is on the same origin as the
  // iframe (the proxy), so the session cookie just travels.
  const supervisor = getSupervisor();
  const auth = checkPreviewAuth(request, workspaceId, (t) =>
    supervisor.isTokenValid(workspaceId, t),
  );
  if (!auth.ok) {
    return unauthorized();
  }

  // --- WebSocket gate -------------------------------------------
  const upgrade = request.headers.get('upgrade');
  if (upgrade && upgrade.toLowerCase() === 'websocket') {
    return badGateway(
      'preview_websocket_unsupported',
      'WebSocket upgrades are not supported in this preview. ' +
        'Reload manually to see changes (HMR is on the roadmap).',
    );
  }

  // --- Port + Host header resolution ---------------------------
  let port: number | null = null;
  let upstreamHost: string | null = null;
  if (mode === 'portless') {
    const hostname = ws.portless_hostname?.trim() || derivePortlessHostname({ slug: ws.slug });
    const route = findRoute(hostname);
    if (!route) {
      return serviceUnavailable(
        'portless_route_missing',
        `No Portless app registered as ${hostname}.localhost. Run \`portless run\` inside the workspace, then refresh.`,
      );
    }
    port = route.port;
    // Preserve the hostname semantics — apps that rely on Host for
    // cookie scopes, OAuth callbacks, or `req.hostname` checks need to
    // see the same value Portless's proxy would have sent them.
    upstreamHost = `${hostname}.localhost`;
  } else {
    port = supervisor.getPort(workspaceId);
    if (!port) {
      return serviceUnavailable(
        'preview_not_running',
        'The preview process isn\'t running. ' +
          'Open the preview pane and click Start, or set a preview command in workspace settings.',
      );
    }
  }

  // --- Build upstream URL --------------------------------------
  const subpath = pathSegments.map(encodeURIComponent).join('/');

  // Strip the `_pt` query param before forwarding so we don't leak it
  // to the dev server (it's noise from the app's perspective).
  const forwardedQuery = new URLSearchParams(request.nextUrl.searchParams);
  forwardedQuery.delete(PREVIEW_QUERY_TOKEN);
  const queryString = forwardedQuery.toString();

  const upstreamUrl = `http://127.0.0.1:${port}/${subpath}${queryString ? '?' + queryString : ''}`;

  // --- Filter request headers ---------------------------------
  const forwardedHeaders = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (STRIP_INBOUND.has(lower)) continue;
    forwardedHeaders.set(name, value);
  }
  if (upstreamHost) {
    // Portless mode: forward Host = `<portless-name>.localhost`. Node's
    // fetch sets Host automatically based on the URL, but explicit beats
    // implicit and some apps inspect this header verbatim.
    forwardedHeaders.set('host', upstreamHost);
  }

  // Forward only the cookies the dev app legitimately needs to see.
  // Drop:
  //   - Flow's own session cookie (`flow_session`) — the dev server has
  //     no business seeing it, and leaking would let it impersonate the
  //     user against Flow's API.
  //   - Per-workspace preview cookies (`flow_preview_*`) — these are
  //     between the browser and our proxy only.
  // Everything else (the dev app's own login cookies, analytics, etc.)
  // passes through. Exact-name match, not endsWith — `_session` is
  // common enough as a suffix in unrelated apps that fuzzy matching
  // would drop legitimate cookies.
  const previewCookie = previewCookieName(workspaceId);
  const rawCookie = request.headers.get('cookie');
  if (rawCookie) {
    const filtered = rawCookie
      .split(/;\s*/)
      .filter((c) => {
        const name = c.split('=', 1)[0]?.trim();
        if (!name) return false;
        if (name === SESSION_COOKIE_NAME) return false;
        if (name === previewCookie) return false;
        // Also drop any *other* flow_preview_<id> cookie that may exist
        // for sibling workspaces — they're orthogonal to this proxy.
        if (name.startsWith('flow_preview_')) return false;
        return true;
      })
      .join('; ');
    if (filtered) forwardedHeaders.set('cookie', filtered);
  }

  // --- Body forwarding -----------------------------------------
  // Methods without bodies (GET, HEAD, OPTIONS) must pass `body: undefined`
  // for `fetch` to be happy.
  const methodHasBody = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const body = methodHasBody ? request.body : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: forwardedHeaders,
      body: body as BodyInit | undefined,
      redirect: 'manual',
      cache: 'no-store',
      // Required for streaming request bodies in Node fetch.
      // @ts-expect-error - duplex is a valid option but not in lib.dom.d.ts
      duplex: 'half',
    });
  } catch (err) {
    return badGateway(
      'preview_upstream_unreachable',
      `Couldn't reach the dev server at 127.0.0.1:${port}. ` +
        (err instanceof Error ? err.message : String(err)) +
        '. The dev server may still be starting up — try again in a moment.',
    );
  }

  // --- Mirror response -----------------------------------------
  const outHeaders = new Headers();
  for (const [name, value] of upstream.headers) {
    if (STRIP_OUTBOUND.has(name.toLowerCase())) continue;
    outHeaders.set(name, value);
  }

  // Rewrite Set-Cookie headers from the upstream:
  //   - Drop entirely if the cookie name is Flow-reserved
  //     (`flow_session` or any `flow_preview_*`) — defense against a
  //     dev app trying to spoof our auth cookies.
  //   - Force `Path=/preview/<workspace-id>/` so the cookie can only
  //     fire on this workspace's proxy requests, never on `/api/*`
  //     or any other Flow path.
  //   - Strip `Domain=` (we want the cookie scoped to Flow's origin
  //     regardless of what Host header the dev app saw).
  // See `src/lib/preview/rewrite-set-cookie.ts` for the full rationale.
  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    outHeaders.delete('set-cookie');
    const rewritten = rewriteSetCookieList(setCookies, { workspaceId });
    for (const c of rewritten) outHeaders.append('set-cookie', c);
  }

  // Set the per-workspace preview cookie when auth came via query token,
  // so subsequent in-iframe requests don't need the `_pt` param.
  if (auth.via === 'preview_query') {
    const token = request.nextUrl.searchParams.get(PREVIEW_QUERY_TOKEN);
    if (token) {
      const c = buildPreviewCookieValue(workspaceId, token, request);
      outHeaders.append(
        'set-cookie',
        [
          `${c.name}=${c.value}`,
          `Path=${c.path}`,
          c.httpOnly ? 'HttpOnly' : '',
          `SameSite=${c.sameSite.charAt(0).toUpperCase() + c.sameSite.slice(1)}`,
          c.secure ? 'Secure' : '',
          `Max-Age=${c.maxAge}`,
        ]
          .filter(Boolean)
          .join('; '),
      );
    }
  }

  // --- Body handling --------------------------------------------
  let outBody: BodyInit | null = upstream.body;
  const contentType = upstream.headers.get('content-type') ?? '';
  const isHtml = contentType.includes('text/html');

  if (isHtml && upstream.body) {
    const injector = createBaseTagInjector(`/preview/${workspaceId}/`);
    outBody = upstream.body.pipeThrough(injector);
  }

  return new Response(outBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

// ─── HTTP method exports ─────────────────────────────────────

export const GET = handle;
export const HEAD = handle;
export const OPTIONS = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;

// ─── Error helpers ───────────────────────────────────────────

function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function errorPage(code: string, title: string, message: string, status: number): Response {
  // The iframe parent can't read the body of an opaque error so we lean
  // on visible HTML inside the iframe instead. Style is minimal so the
  // page is readable in the small iframe viewport.
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { background: #0a0a0a; color: #fafafa; font: 14px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; padding: 24px 28px; }
    h1 { font-size: 16px; font-weight: 600; margin: 0 0 12px; color: #fafafa; }
    p { color: #a3a3a3; margin: 0 0 16px; max-width: 56ch; }
    code { background: #1f1f1f; color: #e5e5e5; padding: 2px 6px; border-radius: 4px; font: 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .code-line { color: #737373; font: 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace; margin-top: 24px; }
  </style>
</head>
<body>
  <h1>${htmlEscape(title)}</h1>
  <p>${htmlEscape(message)}</p>
  <div class="code-line"><code>${htmlEscape(code)}</code> · status ${status}</div>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function badRequest(code: string, message: string): Response {
  return errorPage(code, 'Bad request', message, 400);
}
function unauthorized(): Response {
  return errorPage(
    'preview_unauthorized',
    'Sign in to view this preview',
    'Open Flow in a tab and sign in, then refresh this view.',
    401,
  );
}
function notFound(code: string, message: string): Response {
  return errorPage(code, 'Not found', message, 404);
}
function serviceUnavailable(code: string, message: string): Response {
  return errorPage(code, 'Preview not running', message, 503);
}
function badGateway(code: string, message: string): Response {
  return errorPage(code, 'Upstream unavailable', message, 502);
}

