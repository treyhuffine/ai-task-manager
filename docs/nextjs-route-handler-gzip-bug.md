# Next.js Bug: App Router Route Handlers Are Never Gzipped by `next start`

Status: confirmed upstream bug, unfixed as of Next 16.2.11 (latest stable, checked 2026-07-22). Affects every App Router app that serves JSON from route handlers behind bare `next start`. Flow works around it app-side (see `docs/perf-root-cause.md`, fix 3).

## Summary

Next.js documents that `next start` compresses responses by default (`compress: true`), and the compression middleware is in fact active. It compresses pages, middleware responses, and static files. It silently skips **every App Router route handler response**, no matter the size or content type. The cause is a type mismatch between two of Next's own internal layers: route-handler headers are stored as arrays, and the compression filter only accepts strings.

There is no config fix. `compress: true` is already on. Flipping it does nothing for route handlers.

## Mechanism

Three steps, all inside Next's own code (paths relative to `node_modules/next/dist`):

1. **Compression is wired for all requests** in `server/lib/router-server.js:112`:

```js
compress = (0, _compression.default)();
```

2. **Route handler responses copy headers through `appendHeader`**, which always stores the value as an array, even for a single value. `server/base-http/node.js:124-133`:

```js
appendHeader(name, value) {
    const currentValues = this.getHeaderValues(name) ?? [];
    if (!currentValues.includes(value)) {
        this._res.setHeader(name, [...currentValues, value]);
        // Content-Type becomes ['application/json']
    }
    return this;
}
```

The call site is `server/send-response.js:51` (invoked from the compiled route template at `build/templates/app-route.js:312`): every header of the handler's `Response` goes through `res.appendHeader(name, value)`.

3. **The bundled compression filter requires a string Content-Type.** Its `shouldCompress` runs `compressible(res.getHeader('Content-Type'))`, and the mime lookup type-checks for a string. It receives `['application/json']`, the check fails, and the response is classified not compressible. With `DEBUG=compression` the middleware logs:

```
compression [ 'application/json' ] not compressible → no compression: filtered
```

Pages and static files write headers with plain string `setHeader`, which is why exactly those compress and route handlers never do.

Note the bundled `compression` library does support a `filter` option, but Next calls `compression()` with zero options and `next.config` exposes `compress` as a boolean only, so there is no configuration path to fix it short of replacing `next start` with a custom server.

## Reproduction

On a clean Next 16.1.6 app (also reproduces on 16.2.11, the code is identical):

```js
// app/api/big/route.js
export async function GET() {
  const data = Array(5000).fill({ id: 1, name: 'example', pad: 'x'.repeat(100) });
  return Response.json(data);
}
```

```bash
next build && DEBUG=compression next start
curl -sv -H "Accept-Encoding: gzip, br" http://localhost:3000/api/big -o /dev/null
# -> no content-encoding, Transfer-Encoding: chunked, full raw bytes
curl -sv -H "Accept-Encoding: gzip" http://localhost:3000/ -o /dev/null
# -> Content-Encoding: gzip (pages compress fine)
```

Measured on Flow prod: `/api/tasks` is 976KB raw and would be 256KB gzipped (3.8x).

## Why almost nobody notices

Deployments on Vercel get compression applied at their CDN edge, downstream of Next, so the broken middleware is invisible to every Vercel customer. Self-hosters behind nginx, Caddy, or Cloudflare are similarly masked by proxy-level compression. The bug only bites bare `next start` with nothing compressing in front, and even then nothing logs the silent filter bail. Flow hit it because prod serves `next start` directly through a tunnel that forwards bytes verbatim.

## Upstream history (checked 2026-07-22)

- [vercel/next.js#73693](https://github.com/vercel/next.js/issues/73693) (Dec 2024): exact report, auto-closed by a bot 18 seconds after filing for an invalid repro link. No human response.
- [vercel/next.js#73695](https://github.com/vercel/next.js/issues/73695) (Dec 2024 re-file): still open, zero maintainer comments in 19 months. A community reply incorrectly claims the behavior is by design.
- [vercel/next.js#51160](https://github.com/vercel/next.js/issues/51160) (Jun 2023): the same array-header mechanism triggered via middleware header copies. Closed March 2025 with zero maintainer engagement.

No one in any thread has posted the actual mechanism (array Content-Type vs string-only filter). The upstream fix is one line in either layer: make `send-response` use `setHeader` for single-value headers, or make the filter tolerate array values.

## Workarounds

1. **In-handler gzip (Flow's choice).** A `jsonResponse(data, request)` helper that stringifies, and when the body exceeds ~4KB and the request accepts gzip, returns gzipped bytes with `Content-Encoding: gzip`, explicit `Content-Length` (also eliminates chunked transfer), and `Vary: Accept-Encoding` on both branches. Verified working on Next 16: 593,781 bytes to 4,881 in the repro. `gzipSync` blocks the event loop ~10-30ms at 1MB, fine at this scale. This helper is also the natural seam for ETag/304 support.
2. **Compressing reverse proxy** in front of `next start` (nginx, Caddy). Works, adds an infra layer to operate.
3. **Compress at the tunnel/CDN edge.** For Flow, beamd's edge can gzip any identity-encoded compressible response (perf plan fix 9). Fixes the class for every tunneled origin, not just this app.
4. **patch-package** on `base-http/node.js` `appendHeader` or on the compressible check. Fragile across Next upgrades, not chosen.
