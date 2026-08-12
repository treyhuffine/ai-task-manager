import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  compressJsonResponse,
  isCompressible,
  negotiateEncoding,
  withCompression,
} from './compression';

/** A request advertising the given Accept-Encoding. */
function req(acceptEncoding?: string): Request {
  return new Request('http://localhost/api/tasks', {
    headers: acceptEncoding ? { 'accept-encoding': acceptEncoding } : {},
  });
}

/** A JSON response whose body is large enough to clear the 1KiB threshold. */
function bigJson(): Response {
  return Response.json(
    Array.from({ length: 200 }, (_, i) => ({ id: i, title: `task number ${i}` })),
  );
}

/** An SSE response shaped exactly like the app's three stream routes. */
function sseResponse(): Response {
  return new Response(new ReadableStream(), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

describe('negotiateEncoding', () => {
  it('prefers brotli, falls back to gzip', () => {
    expect(negotiateEncoding('gzip, deflate, br')).toBe('br');
    expect(negotiateEncoding('gzip, deflate')).toBe('gzip');
    expect(negotiateEncoding('deflate')).toBeNull();
    expect(negotiateEncoding(null)).toBeNull();
  });

  it('treats q=0 as a refusal', () => {
    // A client saying `br;q=0` is explicitly opting out, not expressing a
    // weak preference.
    expect(negotiateEncoding('br;q=0, gzip')).toBe('gzip');
    expect(negotiateEncoding('br;q=0, gzip;q=0')).toBeNull();
    expect(negotiateEncoding('br;q=0.5, gzip')).toBe('br');
  });

  it('accepts a wildcard', () => {
    expect(negotiateEncoding('*')).toBe('br');
    expect(negotiateEncoding('*;q=0')).toBeNull();
  });
});

describe('isCompressible', () => {
  it('accepts JSON', () => {
    expect(isCompressible(Response.json({ a: 1 }))).toBe(true);
  });

  it('refuses an SSE stream three separate ways', () => {
    // This is the case that must never regress: compressing an event
    // stream buffers it, and the terminal appears to hang rather than error.
    expect(isCompressible(sseResponse())).toBe(false);

    // Content type alone is enough.
    expect(isCompressible(new Response('x', {
      headers: { 'Content-Type': 'text/event-stream' },
    }))).toBe(false);

    // no-transform alone is enough, even on JSON.
    expect(isCompressible(new Response('{}', {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache, no-transform' },
    }))).toBe(false);
  });

  it('refuses non-JSON and already-encoded bodies', () => {
    expect(isCompressible(new Response('hi', {
      headers: { 'Content-Type': 'text/plain' },
    }))).toBe(false);
    expect(isCompressible(new Response('x', {
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
    }))).toBe(false);
    expect(isCompressible(new Response(null, { status: 204 }))).toBe(false);
  });
});

describe('compressJsonResponse', () => {
  it('gzips and round-trips to the original JSON', async () => {
    const original = await bigJson().json();
    const res = await compressJsonResponse(req('gzip'), bigJson());

    expect(res.headers.get('content-encoding')).toBe('gzip');
    const raw = Buffer.from(await res.arrayBuffer());
    expect(JSON.parse(gunzipSync(raw).toString())).toEqual(original);
  });

  it('brotli-compresses when offered, and beats gzip', async () => {
    const original = await bigJson().json();
    const br = await compressJsonResponse(req('gzip, deflate, br'), bigJson());
    const gz = await compressJsonResponse(req('gzip'), bigJson());

    expect(br.headers.get('content-encoding')).toBe('br');
    const brBytes = Buffer.from(await br.arrayBuffer());
    const gzBytes = Buffer.from(await gz.arrayBuffer());
    expect(brBytes.byteLength).toBeLessThan(gzBytes.byteLength);
    expect(JSON.parse(brotliDecompressSync(brBytes).toString())).toEqual(original);
  });

  it('actually shrinks a realistic payload substantially', async () => {
    const uncompressed = Buffer.byteLength(JSON.stringify(await bigJson().json()));
    const res = await compressJsonResponse(req('gzip'), bigJson());
    const compressed = Number(res.headers.get('content-length'));
    expect(compressed).toBeLessThan(uncompressed / 3);
  });

  it('sets Vary on both branches', async () => {
    // Without Vary on the *uncompressed* branch too, a cache can hand
    // those bytes to a client that asked for gzip, and vice versa.
    const compressed = await compressJsonResponse(req('gzip'), bigJson());
    const plain = await compressJsonResponse(req(), bigJson());
    expect(compressed.headers.get('vary')).toBe('Accept-Encoding');
    expect(plain.headers.get('vary')).toBe('Accept-Encoding');
    expect(plain.headers.get('content-encoding')).toBeNull();
  });

  it('appends to an existing Vary rather than replacing it', async () => {
    const res = await compressJsonResponse(
      req('gzip'),
      Response.json({ a: 'x'.repeat(2000) }, { headers: { Vary: 'Origin' } }),
    );
    expect(res.headers.get('vary')).toBe('Origin, Accept-Encoding');
  });

  it('skips bodies below the size threshold', async () => {
    const res = await compressJsonResponse(req('gzip, br'), Response.json({ ok: true }));
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });

  it('passes an SSE response through untouched and unread', async () => {
    const sse = sseResponse();
    const res = await compressJsonResponse(req('gzip, br'), sse);
    // Identity, not a copy: the body was never consumed, so the stream is
    // still live for the client.
    expect(res).toBe(sse);
    expect(res.bodyUsed).toBe(false);
  });

  it('preserves status and custom headers', async () => {
    const res = await compressJsonResponse(
      req('gzip'),
      Response.json({ error: 'x'.repeat(2000) }, { status: 409, headers: { 'X-Trace': 'abc' } }),
    );
    expect(res.status).toBe(409);
    expect(res.headers.get('x-trace')).toBe('abc');
    expect(res.headers.get('content-encoding')).toBe('gzip');
  });

  it('reports the compressed length in Content-Length', async () => {
    const res = await compressJsonResponse(req('gzip'), bigJson());
    const actual = (await res.arrayBuffer()).byteLength;
    expect(Number(res.headers.get('content-length'))).toBe(actual);
  });

  it('ships the original when compression would make it bigger', async () => {
    // Random base64 is incompressible; gzip framing makes it grow.
    const noise = Buffer.from(
      Array.from({ length: 4096 }, (_, i) => (i * 2654435761) % 256),
    ).toString('base64');
    const res = await compressJsonResponse(req('gzip'), Response.json({ noise }));
    if (res.headers.get('content-encoding') === null) {
      expect(await res.json()).toEqual({ noise });
    }
    // Either way the client must never receive more bytes than the original.
    expect(Number(res.headers.get('content-length'))).toBeLessThanOrEqual(
      Buffer.byteLength(JSON.stringify({ noise })),
    );
  });
});

describe('withCompression', () => {
  it('compresses whatever the handler returns, from any return path', async () => {
    const handler = withCompression(async (request: Request) => {
      // An error path — exactly the kind of return a per-call-site swap
      // tends to miss.
      if (new URL(request.url).searchParams.has('fail')) {
        return Response.json({ error: 'x'.repeat(4000) }, { status: 500 });
      }
      return bigJson();
    });

    const ok = await handler(req('gzip'), undefined);
    expect(ok.headers.get('content-encoding')).toBe('gzip');

    const failed = await handler(
      new Request('http://localhost/api/tasks?fail=1', {
        headers: { 'accept-encoding': 'gzip' },
      }),
      undefined,
    );
    expect(failed.status).toBe(500);
    expect(failed.headers.get('content-encoding')).toBe('gzip');
  });

  it('forwards the route context through untouched', async () => {
    const handler = withCompression(async (_r: Request, ctx: { params: { id: string } }) =>
      Response.json({ id: ctx.params.id }),
    );
    const res = await handler(req(), { params: { id: 'abc' } });
    expect(await res.json()).toEqual({ id: 'abc' });
  });
});
