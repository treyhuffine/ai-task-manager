import http from 'node:http';
import { pathToFileURL } from 'node:url';

// Stateless OAuth redirect landing page. No accounts, cookies, tokens, or logs.
// TLS terminates at the hosting provider. The only destination is the Ri app.
export function relayResponse(rawUrl, method = 'GET') {
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
  };
  const fail = (status) => ({ status, headers, body: 'Invalid callback. Return to Ri and start connecting again.' });
  if (method !== 'GET' || rawUrl.length > 16_384) return fail(400);
  const url = new URL(rawUrl, 'https://callback.invalid');
  if (url.pathname === '/health' && !url.search) return { status: 200, headers, body: 'OK' };
  if (url.pathname !== '/oauth/callback') return fail(404);
  const params = url.searchParams;
  if (!params.get('state') || (!params.get('code') && !params.get('error')) || [...params].length > 24) return fail(400);
  const seen = new Set();
  for (const [key, value] of params) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key) || /token|secret|verifier|redirect|return/i.test(key) || value.length > 4096 || seen.has(key)) return fail(400);
    seen.add(key);
  }
  const link = `ri://oauth/callback?${params.toString()}`.replaceAll('&', '&amp;');
  return { status: 200, headers, body: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Return to Ri</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#181a18;color:#f5f2ea;font:16px system-ui}main{max-width:28rem;padding:2rem}a{display:inline-block;background:#f5f2ea;color:#181a18;padding:12px 20px;border-radius:8px;text-decoration:none}p{line-height:1.6;color:#bbc0b7}</style><main><h1>Return to Ri</h1><p>Finish connecting in the desktop app where you started. You can close this tab afterwards.</p><a href="${link}">Open Ri</a></main></html>` };
}

export function createRelayServer() {
  const server = http.createServer((request, response) => {
    try {
      const result = relayResponse(request.url || '/', request.method);
      response.writeHead(result.status, result.headers).end(result.body);
    } catch { response.writeHead(400).end('Invalid callback'); }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 30;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createRelayServer();
  server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
  process.once('SIGTERM', () => { server.close(); server.closeIdleConnections(); });
}
