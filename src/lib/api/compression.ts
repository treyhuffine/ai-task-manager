/**
 * Compression for JSON route handlers.
 *
 * Next 16.1.6 has an active compression middleware that silently skips every
 * App Router route handler. Its `sendResponse` copies headers with
 * `appendHeader`, which stores Content-Type as an array, and the compression
 * filter requires a string, so it bails. Pages and static files use
 * `setHeader` with a string, which is why only they gzip. Until that lands
 * upstream, API responses have to compress themselves — `/api/tasks` was
 * shipping 976KB uncompressed where gzip takes it to roughly 256KB.
 *
 * Applied as a wrapper around a whole handler rather than swapped in at each
 * `Response.json` call. `tasks` and `notes` have five return points each, so
 * a per-call-site swap is dozens of edits with a standing chance of missing
 * an error path and leaving it uncompressed. Wrapping catches every return,
 * including the ones nobody remembers.
 *
 * The safety property that matters: this must never touch a stream. SSE
 * responses compressed into a buffer stop being live, which would break the
 * terminal and the session streams in a way that looks like a hang rather
 * than an error. Three independent guards below make that impossible, and
 * `compression.test.ts` asserts each one.
 */

import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

export type Encoding = 'br' | 'gzip';

/**
 * Don't spend CPU on responses too small to benefit. 1KiB matches nginx's
 * `gzip_min_length` and the `compression` package's default; the 4KB the
 * original audit suggested skips real wins on rail and status payloads.
 */
const MIN_COMPRESS_BYTES = 1024;

/**
 * Brotli quality. The default (11) is far too slow for per-request use.
 * At 4 it runs about as fast as gzip while still coming out ~15% smaller
 * on JSON, which is worth having on the tunnel leg.
 */
const BROTLI_QUALITY = 4;

/**
 * Only `application/json` is ever compressed. A strict allowlist rather
 * than a "compressible types" check, because the dangerous case —
 * `text/event-stream` — is text and would pass a looser filter.
 */
const JSON_CONTENT_TYPE = /^application\/json\b/i;

/**
 * Preferred encoding from an `Accept-Encoding` header, or null.
 *
 * Honours `q=0` as an explicit refusal, which is how a client opts out of
 * an encoding it would otherwise be assumed to take.
 */
export function negotiateEncoding(header: string | null): Encoding | null {
  if (!header) return null;

  const q = new Map<string, number>();
  for (const part of header.split(',')) {
    const [rawName, ...params] = part.trim().split(';');
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const parsed = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
    q.set(name, Number.isFinite(parsed) ? parsed : 1);
  }

  const wildcard = q.get('*') ?? 0;
  const rank = (name: string) => q.get(name) ?? (wildcard > 0 ? wildcard : 0);

  if (rank('br') > 0) return 'br';
  if (rank('gzip') > 0) return 'gzip';
  return null;
}

/**
 * Whether a response may be compressed at all, before size is considered.
 *
 * Each rejection is a separate way the SSE routes stay untouched: they send
 * `text/event-stream` (not JSON), and they already set `no-transform`, which
 * is the HTTP-level instruction not to re-encode a payload.
 */
export function isCompressible(res: Response): boolean {
  if (!res.body) return false;
  if (res.headers.has('content-encoding')) return false;

  const cacheControl = res.headers.get('cache-control');
  if (cacheControl && /\bno-transform\b/i.test(cacheControl)) return false;

  return JSON_CONTENT_TYPE.test(res.headers.get('content-type') ?? '');
}

/** Add `Accept-Encoding` to Vary without clobbering an existing value. */
function addVary(headers: Headers): Headers {
  const existing = headers.get('vary');
  if (!existing) {
    headers.set('vary', 'Accept-Encoding');
    return headers;
  }
  const already = existing
    .split(',')
    .some((v) => v.trim().toLowerCase() === 'accept-encoding');
  if (!already) headers.set('vary', `${existing}, Accept-Encoding`);
  return headers;
}

/**
 * Node's `Buffer` isn't structurally a `BodyInit` under the DOM lib, so hand
 * `Response` a plain view over the same memory. A view, not a copy — this
 * runs on every compressed response.
 */
function toBody(buf: Buffer): Uint8Array<ArrayBuffer> {
  // The cast narrows `ArrayBufferLike` to `ArrayBuffer`, which is what
  // `BodyInit` requires since TS made typed arrays generic over their
  // backing buffer. Sound here: these buffers come from `res.arrayBuffer()`
  // and zlib, neither of which returns a SharedArrayBuffer. Offset and
  // length are respected because zlib can hand back a pooled Buffer whose
  // view does not start at zero.
  return new Uint8Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength);
}

function compress(body: Buffer, encoding: Encoding): Promise<Buffer> {
  // Always async. A 976KB body through `gzipSync` blocks the event loop for
  // 10-20ms per request, on a server that already blocks it for every
  // synchronous SQLite call.
  if (encoding === 'gzip') return gzipAsync(body) as Promise<Buffer>;
  return brotliAsync(body, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: body.byteLength,
    },
  }) as Promise<Buffer>;
}

/**
 * Compress a JSON response if the client accepts it and it's worth doing.
 *
 * Returns a new `Response` either way, because reading the body to measure
 * it consumes the original. `Vary: Accept-Encoding` is set on both branches
 * — omitting it on the uncompressed one lets a cache serve those bytes to a
 * client that asked for gzip, and vice versa.
 */
export async function compressJsonResponse(
  request: Request,
  res: Response,
): Promise<Response> {
  try {
    return await compressOrThrow(request, res);
  } catch {
    // Compression is an optimization layered *after* the handler has already
    // produced a correct response. Anything that goes wrong in here — a
    // caller that passed something other than a real Request, a body that
    // can't be buffered, a zlib failure — must not turn that 200 into a 500.
    // Fall back to the response the handler actually returned.
    //
    // Not theoretical: this fired the first time a route test invoked a
    // wrapped handler with a stub request, where reading `accept-encoding`
    // threw and took a passing route down with it.
    return res;
  }
}

async function compressOrThrow(request: Request, res: Response): Promise<Response> {
  if (!isCompressible(res)) return res;

  // Tolerate a caller without real headers rather than assuming a
  // well-formed Request; an absent header simply means "no encoding".
  const accept =
    typeof request?.headers?.get === 'function'
      ? request.headers.get('accept-encoding')
      : null;
  const encoding = negotiateEncoding(accept);
  const body = Buffer.from(await res.arrayBuffer());

  const headers = addVary(new Headers(res.headers));
  const init: ResponseInit = {
    status: res.status,
    statusText: res.statusText,
    headers,
  };

  if (!encoding || body.byteLength < MIN_COMPRESS_BYTES) {
    headers.set('content-length', String(body.byteLength));
    return new Response(toBody(body), init);
  }

  const compressed = await compress(body, encoding);

  // Pathological inputs (already-compressed blobs, high-entropy strings) can
  // come out larger. Ship the original when that happens.
  if (compressed.byteLength >= body.byteLength) {
    headers.set('content-length', String(body.byteLength));
    return new Response(toBody(body), init);
  }

  headers.set('content-encoding', encoding);
  headers.set('content-length', String(compressed.byteLength));
  return new Response(toBody(compressed), init);
}

/**
 * Wrap a route handler so whatever JSON it returns is compressed.
 *
 * Generic over both parameters: over the request so handlers typed against
 * `NextRequest` stay that way (widening it to `Request` would fail under
 * `strictFunctionTypes`), and over the context so it composes with dynamic
 * routes, whose second argument carries `params`.
 */
// `Ctx` defaults to `unknown`, not `undefined`. Next's generated route
// validator types every handler as taking a context — `{ params: Promise<{}> }`
// even on static routes — and parameters are contravariant, so a handler
// declaring `undefined` there fails to satisfy it. `unknown` accepts whatever
// Next passes, while dynamic routes still infer their real `params` shape
// from the wrapped handler.
// `ctx` is optional on the *returned* function so a wrapped handler stays
// callable as `GET(request)` — route tests invoke handlers directly and
// static routes have no params worth passing. An optional parameter still
// satisfies Next's validator, which types every handler as taking a context.
export function withCompression<Req extends Request, Ctx = unknown>(
  handler: (request: Req, ctx: Ctx) => Response | Promise<Response>,
): (request: Req, ctx?: Ctx) => Promise<Response> {
  return async (request, ctx) =>
    compressJsonResponse(request, await handler(request, ctx as Ctx));
}
