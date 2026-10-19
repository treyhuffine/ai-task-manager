import { describe, expect, it, vi } from 'vitest';
import { apiKeyHeaderHint, detectMcpAuth, MCP_PROBE_TIMEOUT_MS } from './mcp-auth-detect';

/**
 * Every response here is an intercepted fixture. Several reproduce what the
 * real servers answered unauthenticated on October 19, 2026: Bits & Bolts
 * (OpenAI's sample app, local and remote), MagicPath, Excalidraw, GitHub and
 * Wrike. No request leaves this process.
 */
type Route = (request: Request) => Response | undefined | Promise<Response | undefined>;

function fixture(route: Route) {
  const requests: Request[] = [];
  const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    expect(request.headers.has('authorization'), `no credentials to ${request.url}`).toBe(false);
    expect(request.headers.has('cookie')).toBe(false);
    expect(request.redirect).toBe('manual');
    expect(request.credentials).toBe('omit');
    const response = await route(request);
    if (response) return response;
    // Any well-known document the probe asks for and the fixture doesn't serve is absent.
    if (request.method === 'GET' && request.url.includes('/.well-known/')) return new Response(null, { status: 404 });
    throw new Error(`Unexpected fixture request: ${request.method} ${request.url}`);
  });
  return { fetch: fetchFixture, requests };
}

const initializeResult = (serverInfo?: Record<string, unknown>) => ({ jsonrpc: '2.0', id: 1, result: {
  protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: true } }, ...(serverInfo ? { serverInfo } : {}),
} });
const sse = (message: unknown, headers: Record<string, string> = {}) =>
  new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream', ...headers } });
async function initializeRequest(request: Request) {
  expect(request.method).toBe('POST');
  expect(request.headers.get('accept')).toBe('application/json, text/event-stream');
  const body = await request.json() as { jsonrpc: string; method: string; params: { clientInfo: { name: string } } };
  expect(body).toMatchObject({ jsonrpc: '2.0', method: 'initialize', params: { clientInfo: { name: 'Ri' } } });
  return body;
}
const magicpath = {
  challenge: 'Bearer resource_metadata="https://api.magicpath.ai/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="A valid MagicPath MCP access token is required."',
  resource: { resource: 'https://api.magicpath.ai/mcp', authorization_servers: ['https://api.magicpath.ai/'], scopes_supported: ['magicpath:read', 'magicpath:write'], resource_name: 'MagicPath MCP' },
  server: {
    issuer: 'https://api.magicpath.ai/', authorization_endpoint: 'https://api.magicpath.ai/authorize', response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'], token_endpoint: 'https://api.magicpath.ai/token', token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    grant_types_supported: ['authorization_code', 'refresh_token'], scopes_supported: ['magicpath:read', 'magicpath:write'],
    registration_endpoint: 'https://api.magicpath.ai/register',
  },
};
const github = {
  challenge: 'Bearer error="invalid_request", error_description="No access token was provided in this request", resource_metadata="https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/"',
  resource: { resource: 'https://api.githubcopilot.com/mcp/', authorization_servers: ['https://github.com/login/oauth'], scopes_supported: ['repo', 'read:org'], bearer_methods_supported: ['header'], resource_name: 'GitHub MCP Server' },
  server: {
    issuer: 'https://github.com/login/oauth', authorization_endpoint: 'https://github.com/login/oauth/authorize', token_endpoint: 'https://github.com/login/oauth/access_token',
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], scopes_supported: ['offline_access'],
  },
};

describe('detectMcpAuth', () => {
  it('reads a normal initialize answer as no sign-in, from the first SSE event', async () => {
    // Excalidraw and the local Bits & Bolts store answer this way.
    const { fetch, requests } = fixture(async request => {
      if (request.url === 'https://mcp.excalidraw.com/mcp') { await initializeRequest(request); return sse(initializeResult({ name: 'Excalidraw', version: '1.0.0' })); }
      return undefined;
    });
    await expect(detectMcpAuth('https://mcp.excalidraw.com/mcp', { fetch })).resolves.toEqual({ method: 'none', server: { name: 'Excalidraw', version: '1.0.0' } });
    expect(requests).toHaveLength(1);
  });

  it('prefers the server title, takes JSON answers too, and lets a stateful session go', async () => {
    const { fetch, requests } = fixture(request => {
      if (request.method === 'POST') return Response.json(initializeResult({ name: 'bits-and-bolts', title: 'Bits & Bolts', version: '0.1.0' }), { headers: { 'mcp-session-id': 'probe-session' } });
      if (request.method === 'DELETE') { expect(request.headers.get('mcp-session-id')).toBe('probe-session'); return new Response(null, { status: 200 }); }
      return undefined;
    });
    await expect(detectMcpAuth('http://localhost:3917/mcp', { fetch })).resolves.toEqual({ method: 'none', server: { name: 'Bits & Bolts', version: '0.1.0' } });
    await vi.waitFor(() => expect(requests.map(request => request.method)).toEqual(['POST', 'DELETE']));
  });

  it('reads a server that only speaks MCP 2026-07-28 as no sign-in', async () => {
    // What the v2 SDK's strict handler (legacy: 'reject') answers a 2025 initialize.
    const remote = fixture(async (request) => {
      await initializeRequest(request);
      return Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32022, message: 'Unsupported protocol version: 2025-11-25', data: { supported: ['2026-07-28'], requested: '2025-11-25' } } }, { status: 400 });
    });
    expect(await detectMcpAuth('https://modern.example/mcp', { fetch: remote.fetch })).toEqual({ method: 'none' });
    expect(remote.requests).toHaveLength(1);
  });

  it('skips a comment event and reports a server that names itself nowhere', async () => {
    const { fetch } = fixture(() => new Response(`: keep-alive\n\nevent: message\ndata: ${JSON.stringify(initializeResult())}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
    await expect(detectMcpAuth('https://mcp.example/mcp', { fetch })).resolves.toEqual({ method: 'none' });
  });

  it('follows the 401 challenge to OAuth with dynamic registration, PKCE and scopes (MagicPath)', async () => {
    const { fetch, requests } = fixture(request => {
      if (request.url === 'https://api.magicpath.ai/mcp') return Response.json({ jsonrpc: '2.0', error: { code: -32001, message: 'A valid MagicPath MCP access token is required.' }, id: null }, { status: 401, headers: { 'www-authenticate': magicpath.challenge } });
      if (request.url === 'https://api.magicpath.ai/.well-known/oauth-protected-resource/mcp') return Response.json(magicpath.resource);
      if (request.url === 'https://api.magicpath.ai/.well-known/oauth-authorization-server') return Response.json(magicpath.server);
      return undefined;
    });
    await expect(detectMcpAuth('https://api.magicpath.ai/mcp', { fetch })).resolves.toEqual({
      method: 'oauth', registration: 'dynamic', authorizationServer: 'https://api.magicpath.ai/',
      resourceMetadataUrl: 'https://api.magicpath.ai/.well-known/oauth-protected-resource/mcp', scopes: ['magicpath:read', 'magicpath:write'], pkce: true,
    });
    expect(requests.map(request => `${request.method} ${request.url}`)).toEqual([
      'POST https://api.magicpath.ai/mcp',
      'GET https://api.magicpath.ai/.well-known/oauth-protected-resource/mcp',
      'GET https://api.magicpath.ai/.well-known/oauth-authorization-server',
    ]);
  });

  it('reads the local Bits & Bolts remote demo over loopback http', async () => {
    const { fetch } = fixture(request => {
      if (request.url === 'http://localhost:3916/bits-and-bolts/mcp') return Response.json({ error: 'Connect a Personal or Work demo account.' }, { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="http://localhost:3916/.well-known/oauth-protected-resource/bits-and-bolts/mcp"' } });
      if (request.url === 'http://localhost:3916/.well-known/oauth-protected-resource/bits-and-bolts/mcp') return Response.json({ resource: 'http://localhost:3916/bits-and-bolts/mcp', authorization_servers: ['http://localhost:3916'], scopes_supported: ['cad'] });
      if (request.url === 'http://localhost:3916/.well-known/oauth-authorization-server') return Response.json({
        issuer: 'http://localhost:3916', authorization_endpoint: 'http://localhost:3916/bits-and-bolts/oauth/authorize', token_endpoint: 'http://localhost:3916/bits-and-bolts/oauth/token',
        registration_endpoint: 'http://localhost:3916/bits-and-bolts/oauth/register', response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'], scopes_supported: ['cad'],
      });
      return undefined;
    });
    await expect(detectMcpAuth('http://localhost:3916/bits-and-bolts/mcp', { fetch })).resolves.toMatchObject({ method: 'oauth', registration: 'dynamic', authorizationServer: 'http://localhost:3916', scopes: ['cad'], pkce: true });
  });

  it('tells OAuth that needs a registered client, through path-aware authorization-server metadata (GitHub)', async () => {
    const { fetch, requests } = fixture(request => {
      if (request.url === 'https://api.githubcopilot.com/mcp/') return new Response('bad request: missing required Authorization header', { status: 401, headers: { 'www-authenticate': github.challenge } });
      if (request.url === 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/') return Response.json(github.resource);
      if (request.url === 'https://github.com/.well-known/oauth-authorization-server/login/oauth') return Response.json(github.server);
      return undefined;
    });
    await expect(detectMcpAuth('https://api.githubcopilot.com/mcp/', { fetch })).resolves.toEqual({
      method: 'oauth', registration: 'registered', authorizationServer: 'https://github.com/login/oauth',
      resourceMetadataUrl: 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/', scopes: ['repo', 'read:org'], pkce: true,
    });
    expect(requests.every(request => request.method === 'GET' || request.url === 'https://api.githubcopilot.com/mcp/')).toBe(true);
  });

  it('tells OAuth by client ID metadata document apart from registration', async () => {
    const { fetch } = fixture(request => {
      if (request.url === 'https://mcp.example/mcp') return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource/mcp"' } });
      if (request.url === 'https://mcp.example/.well-known/oauth-protected-resource/mcp') return Response.json({ resource: 'https://mcp.example/mcp', authorization_servers: ['https://auth.example'] });
      if (request.url === 'https://auth.example/.well-known/oauth-authorization-server') return Response.json({ ...github.server, issuer: 'https://auth.example', client_id_metadata_document_supported: true });
      return undefined;
    });
    await expect(detectMcpAuth('https://mcp.example/mcp', { fetch })).resolves.toMatchObject({ method: 'oauth', registration: 'client_metadata', authorizationServer: 'https://auth.example' });
  });

  it('keeps OAuth when the authorization server publishes no metadata, and says the registration is unknown', async () => {
    const { fetch } = fixture(request => {
      if (request.url === 'https://mcp.example/mcp') return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"' } });
      if (request.url === 'https://mcp.example/.well-known/oauth-protected-resource') return Response.json({ resource: 'https://mcp.example/mcp', authorization_servers: ['https://auth.example/'] });
      return undefined;
    });
    await expect(detectMcpAuth('https://mcp.example/mcp', { fetch })).resolves.toEqual({
      method: 'oauth', registration: 'unknown', authorizationServer: 'https://auth.example/', resourceMetadataUrl: 'https://mcp.example/.well-known/oauth-protected-resource', pkce: true,
    });
  });

  it("takes the challenge's scope over the resource's, and notices missing PKCE S256", async () => {
    // DataForSEO's challenge names scope="api" while its resource metadata lists none.
    const { fetch } = fixture(request => {
      if (request.url === 'https://mcp.dataforseo.com/v3/mcp') return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer error="invalid_token", resource_metadata="https://mcp.dataforseo.com/.well-known/oauth-protected-resource", scope="api"' } });
      if (request.url === 'https://mcp.dataforseo.com/.well-known/oauth-protected-resource') return Response.json({ resource: 'https://mcp.dataforseo.com', authorization_servers: ['https://data.dataforseo.com'] });
      if (request.url === 'https://data.dataforseo.com/.well-known/oauth-authorization-server') return Response.json({ ...magicpath.server, issuer: 'https://data.dataforseo.com', code_challenge_methods_supported: ['plain'] });
      return undefined;
    });
    await expect(detectMcpAuth('https://mcp.dataforseo.com/v3/mcp', { fetch })).resolves.toMatchObject({ method: 'oauth', registration: 'dynamic', scopes: ['api'], pkce: false });
  });

  it('finds legacy OAuth on the server itself when there is no challenge and no resource metadata', async () => {
    const { fetch, requests } = fixture(request => {
      if (request.url === 'https://mcp.example/v1/mcp') return new Response('Unauthorized', { status: 401 });
      if (request.url === 'https://mcp.example/.well-known/oauth-authorization-server') return Response.json({ ...magicpath.server, issuer: 'https://mcp.example' });
      return undefined;
    });
    await expect(detectMcpAuth('https://mcp.example/v1/mcp', { fetch })).resolves.toEqual({ method: 'oauth', registration: 'dynamic', authorizationServer: 'https://mcp.example/', pkce: true });
    expect(requests.map(request => request.url)).toEqual([
      'https://mcp.example/v1/mcp',
      'https://mcp.example/.well-known/oauth-protected-resource/v1/mcp',
      'https://mcp.example/.well-known/oauth-protected-resource',
      'https://mcp.example/.well-known/oauth-authorization-server',
    ]);
  });

  it('reads a bare 401 with no OAuth metadata anywhere as an API key (Wrike), after a bounded search', async () => {
    const { fetch, requests } = fixture(request => request.url === 'https://mcp.wrike.com/v2' ? new Response('Unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } }) : undefined);
    await expect(detectMcpAuth('https://mcp.wrike.com/v2', { fetch })).resolves.toEqual({ method: 'key', status: 401 });
    expect(requests.map(request => `${request.method} ${request.url}`)).toEqual([
      'POST https://mcp.wrike.com/v2',
      'GET https://mcp.wrike.com/.well-known/oauth-protected-resource/v2',
      'GET https://mcp.wrike.com/.well-known/oauth-protected-resource',
      'GET https://mcp.wrike.com/.well-known/oauth-authorization-server',
      'GET https://mcp.wrike.com/.well-known/openid-configuration',
    ]);
  });

  it('reads a 403 the same way and names the header a refusal mentions', async () => {
    const { fetch } = fixture(request => request.method === 'POST' ? Response.json({ error: 'Missing X-API-Key header' }, { status: 403 }) : undefined);
    await expect(detectMcpAuth('https://mcp.example/mcp', { fetch })).resolves.toEqual({ method: 'key', status: 403, header: 'X-API-Key' });
  });

  it('never fetches metadata from an address a saved server could not use', async () => {
    const { fetch, requests } = fixture(request => request.method === 'POST'
      ? new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="http://169.254.169.254/latest/meta-data"' } })
      : undefined);
    await expect(detectMcpAuth('https://mcp.example/mcp', { fetch })).resolves.toEqual({ method: 'key', status: 401 });
    expect(requests.some(request => request.url.includes('169.254.169.254'))).toBe(false);
  });

  it.each([
    [{ code: 'ECONNREFUSED' }, 'Nothing is listening at this address.'],
    [{ code: 'ENOTFOUND' }, "The host name couldn't be found."],
    [{ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }, "The server's TLS certificate isn't trusted."],
    [{ message: 'socket hang up' }, "Couldn't reach the server: socket hang up."],
  ])('explains a failed connection (%o)', async (cause, message) => {
    const { fetch } = fixture(() => { throw new TypeError('fetch failed', { cause }); });
    await expect(detectMcpAuth('https://mcp.example/mcp', { fetch })).resolves.toEqual({ method: 'unknown', reason: 'unreachable', message });
  });

  it('gives up on a server that never answers', async () => {
    const { fetch } = fixture(request => new Promise((_, reject) => { request.signal.addEventListener('abort', () => reject(request.signal.reason)); }));
    await expect(detectMcpAuth('https://mcp.example/mcp', { fetch, timeoutMs: 20 })).resolves.toEqual({ method: 'unknown', reason: 'unreachable', message: "The server didn't answer within 0 seconds." });
    expect(MCP_PROBE_TIMEOUT_MS).toBe(8_000);
  });

  it('follows a redirect on the same origin and stops at one to another', async () => {
    const same = fixture(request => {
      if (request.url === 'https://mcp.example/mcp') return new Response(null, { status: 307, headers: { location: '/mcp/' } });
      if (request.url === 'https://mcp.example/mcp/') return sse(initializeResult({ name: 'Moved' }));
      return undefined;
    });
    await expect(detectMcpAuth('https://mcp.example/mcp', { fetch: same.fetch })).resolves.toEqual({ method: 'none', server: { name: 'Moved' } });
    expect(same.requests.map(request => request.url)).toEqual(['https://mcp.example/mcp', 'https://mcp.example/mcp/']);

    const other = fixture(() => new Response(null, { status: 301, headers: { location: 'https://elsewhere.example/mcp' } }));
    await expect(detectMcpAuth('https://mcp.example/mcp', { fetch: other.fetch })).resolves.toEqual({
      method: 'unknown', reason: 'redirected', status: 301, message: 'This address redirects to https://elsewhere.example. Enter the address it redirects to.',
    });
    expect(other.requests).toHaveLength(1);

    const downgrade = fixture(() => new Response(null, { status: 302, headers: { location: 'http://mcp.example/mcp' } }));
    await expect(detectMcpAuth('https://mcp.example/mcp', { fetch: downgrade.fetch })).resolves.toMatchObject({ method: 'unknown', reason: 'redirected' });

    const loop = fixture(() => new Response(null, { status: 302, headers: { location: '/again' } }));
    await expect(detectMcpAuth('https://mcp.example/mcp', { fetch: loop.fetch })).resolves.toMatchObject({ method: 'unknown', reason: 'not_mcp', message: 'The address keeps redirecting.' });
  });

  it.each([
    [new Response('Not Found', { status: 404 }), { reason: 'not_mcp', status: 404, message: "This address doesn't answer as an MCP server (HTTP 404). Check the path, which is often /mcp." }],
    [new Response(null, { status: 405 }), { reason: 'not_mcp', status: 405, message: "This address doesn't answer as an MCP server (HTTP 405). Check the path, which is often /mcp." }],
    [new Response(null, { status: 429 }), { reason: 'not_mcp', status: 429, message: "This address doesn't answer as an MCP server (HTTP 429)." }],
    [new Response('<html>hello</html>', { status: 200, headers: { 'content-type': 'text/html' } }), { reason: 'not_mcp', status: 200, message: 'This address answers, but not as an MCP server.' }],
    [Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid Request' } }), { reason: 'not_mcp', status: 200, message: 'The server answered initialize with Invalid Request.' }],
    [new Response(null, { status: 503 }), { reason: 'server_error', status: 503, message: 'The server answered with an error (HTTP 503). Try again in a moment.' }],
  ])('says plainly when nothing MCP answers', async (response, expected) => {
    const { fetch } = fixture(() => response);
    await expect(detectMcpAuth('https://mcp.example/mcp', { fetch })).resolves.toEqual({ method: 'unknown', ...expected });
  });

  it('refuses an address a saved server could not use, without a request', async () => {
    const { fetch, requests } = fixture(() => undefined);
    await expect(detectMcpAuth('http://example.com/mcp', { fetch })).resolves.toEqual({ method: 'unknown', reason: 'invalid_url', message: 'Use an https:// URL (http:// is allowed only for localhost).' });
    await expect(detectMcpAuth('not a url', { fetch })).resolves.toMatchObject({ method: 'unknown', reason: 'invalid_url' });
    await expect(detectMcpAuth('', { fetch })).resolves.toMatchObject({ method: 'unknown', reason: 'invalid_url', message: 'A server URL is required.' });
    expect(requests).toHaveLength(0);
  });

  it('stops reading an endless answer at the body cap', async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode('data: '.padEnd(8192, 'x'))); } });
    const { fetch } = fixture(() => new Response(endless, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    await expect(detectMcpAuth('https://mcp.example/mcp', { fetch })).resolves.toMatchObject({ method: 'unknown', reason: 'not_mcp' });
    expect(pulls).toBeLessThan(20);
  });
});

describe('apiKeyHeaderHint', () => {
  it('names a hyphenated key header a refusal mentions, unless Bearer is mentioned too', () => {
    expect(apiKeyHeaderHint(null, '{"error":"Missing X-API-Key header"}')).toBe('X-API-Key');
    expect(apiKeyHeaderHint('ApiKey realm="x-service-token"', '')).toBe('x-service-token');
    expect(apiKeyHeaderHint(null, 'Provide an api-key header')).toBe('api-key');
    expect(apiKeyHeaderHint(null, 'Missing Authorization: Bearer token or X-API-Key')).toBeUndefined();
    expect(apiKeyHeaderHint(null, '{"error":"invalid api_key"}')).toBeUndefined();
    expect(apiKeyHeaderHint(null, 'x-request-id missing')).toBeUndefined();
    expect(apiKeyHeaderHint(null, 'Unauthorized')).toBeUndefined();
  });
});
