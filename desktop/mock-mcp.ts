/** Local OAuth + MCP fixture for the real packaged-app smoke test. */
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';

export async function mockMcp() {
  let origin = '';
  let expected: URLSearchParams | undefined;
  let exchanges = 0;
  const code = randomBytes(24).toString('hex');
  const token = randomBytes(24).toString('hex');
  const registrations: unknown[] = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url!, origin);
    const json = (status: number, value: unknown) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      json(200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
    } else if (url.pathname === '/.well-known/oauth-authorization-server') {
      json(200, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
    } else if (url.pathname === '/register') {
      const metadata = JSON.parse(body); registrations.push(metadata);
      json(201, { ...metadata, client_id: 'desktop-smoke-client' });
    } else if (url.pathname === '/authorize') {
      expected = url.searchParams;
      const callback = new URL(expected.get('redirect_uri')!);
      callback.searchParams.set('code', code); callback.searchParams.set('state', expected.get('state')!);
      response.writeHead(302, { location: callback.href }).end();
    } else if (url.pathname === '/token') {
      const params = new URLSearchParams(body);
      if (params.get('code') !== code || params.get('redirect_uri') !== expected?.get('redirect_uri') || createHash('sha256').update(params.get('code_verifier') || '').digest('base64url') !== expected?.get('code_challenge')) {
        json(400, { error: 'invalid_grant' }); return;
      }
      exchanges++;
      json(200, { access_token: token, token_type: 'Bearer', expires_in: 3600 });
    } else if (url.pathname === '/mcp') {
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.setHeader('www-authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`);
        json(401, { error: 'unauthorized' }); return;
      }
      if (request.method !== 'POST') { response.writeHead(405).end(); return; }
      const message = JSON.parse(body);
      if (!('id' in message)) { response.writeHead(202).end(); return; }
      const result = message.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Desktop smoke', version: '1' } }
        : message.method === 'tools/list' ? { tools: [{ name: 'ping', description: 'Smoke check', inputSchema: { type: 'object', properties: {} } }] } : {};
      json(200, { jsonrpc: '2.0', id: message.id, result });
    } else json(404, {});
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url: `${origin}/mcp`, token, registrations, get exchanges() { return exchanges; }, close() { server.closeAllConnections(); server.close(); } };
}
