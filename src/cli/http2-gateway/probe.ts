/**
 * Readiness probes for the HTTP/2 gateway (see docs/optional-http2.md §4/§6).
 *
 * Readiness requires BOTH an authenticated-independent health response through
 * the public listener AND a real HTTP/2 negotiation — configuration or an HTTPS
 * URL alone is not proof. The probe uses a dedicated client trusting exactly the
 * selected CA / local trust material. It never sets NODE_TLS_REJECT_UNAUTHORIZED
 * or alters global TLS validation.
 */

import http2 from 'node:http2';

export interface Http2ProbeResult {
  ok: boolean;
  /** ALPN protocol actually negotiated, e.g. `h2` or `http/1.1`. */
  negotiatedProtocol: string | null;
  /** `/api/health` status code, when the request completed. */
  status?: number;
  detail?: string;
}

/**
 * Connect to the public listener over TLS trusting `ca`, negotiate ALPN, and
 * request `/api/health`. Resolves with the negotiated protocol and health
 * status. Verifies the certificate against `ca` with `servername` SNI so cert
 * validation is real, not bypassed.
 */
export function probeHttp2(opts: {
  host: string;
  port: number;
  servername: string;
  /** Trust anchor(s). A list lets supplied certs be checked against their chain
   *  plus the system roots without disabling validation. */
  ca: string | string[];
  path?: string;
  timeoutMs?: number;
}): Promise<Http2ProbeResult> {
  const { host, port, servername, ca, path = '/api/health', timeoutMs = 10_000 } = opts;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Http2ProbeResult) => {
      if (settled) return;
      settled = true;
      try {
        client.close();
      } catch {
        /* already closing */
      }
      resolve(result);
    };

    const client = http2.connect(
      `https://${host}:${port}`,
      { ca, servername, ALPNProtocols: ['h2', 'http/1.1'] },
    );

    const timer = setTimeout(
      () => finish({ ok: false, negotiatedProtocol: null, detail: 'probe timed out' }),
      timeoutMs,
    );
    timer.unref?.();

    client.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, negotiatedProtocol: null, detail: err.message });
    });

    client.on('connect', (session) => {
      const negotiatedProtocol =
        (session.socket as { alpnProtocol?: string | false }).alpnProtocol || null;
      const req = client.request({ ':path': path, ':method': 'GET' });
      let status: number | undefined;
      req.on('response', (headers) => {
        status = Number(headers[':status']);
      });
      req.on('error', (err) => {
        clearTimeout(timer);
        finish({ ok: false, negotiatedProtocol, detail: err.message });
      });
      req.resume(); // drain body
      req.on('end', () => {
        clearTimeout(timer);
        finish({
          ok: negotiatedProtocol === 'h2' && status === 200,
          negotiatedProtocol,
          status,
        });
      });
      req.end();
    });
  });
}
