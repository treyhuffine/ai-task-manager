/**
 * Ri's MCP sign-in end to end (docs/mcp-oauth.md): the official MCP client's
 * own OAuth, through the real proxy and routes, as ChatGPT and Claude do it.
 * The owner's Allow is the consent form's POST with the browser's cookie.
 */
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { Client, StreamableHTTPClientTransport, UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { HOME_MCP_PATH } from '@/lib/external-ai/policy';
import { AUTHORIZE_FIELDS } from './consent';

vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/embeddings/embed')>()), generateEmbedding: vi.fn(async () => { throw new Error('No model in this test'); }), upsertEmbedding: vi.fn(async () => {}), deleteEmbedding: vi.fn() }));
vi.mock('@/lib/sessions/workstream', () => ({ coordinateLifecycleChange: vi.fn(async () => {}) }));
vi.mock('@/lib/sessions/workstream-runtime', () => ({ inProcessWorkstreamRuntime: {} }));
vi.mock('@/lib/executor/status-snapshot', () => ({ listRunningSessions: () => [] }));
vi.setConfig({ testTimeout: 60_000 });

const BASE = 'https://home.test';
const MCP = `${BASE}${HOME_MCP_PATH}`;
const CALLBACK = 'https://client.example/callback';
let home: TestHome;
let viewer: string;
const clients: Client[] = [];

beforeAll(async () => {
  await Promise.all([
    import('@/proxy'), import('@/app/api/orchestrator/[transport]/route'),
    import('@/app/api/oauth/token/route'), import('@/app/api/oauth/authorize/route'),
  ]);
}, 120_000);
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-oauth-' });
  const { setRemoteBaseUrl } = await import('@/lib/auth/bootstrap');
  setRemoteBaseUrl(BASE);
  const q = await import('@/lib/db/queries');
  viewer = q.pairDevice({ name: 'Laptop', kind: 'computer' }).token.plaintext;
});
afterEach(async () => {
  const { setMetadataFetchForTests } = await import('./clients');
  setMetadataFetchForTests(null);
  await Promise.all(clients.splice(0).map(client => client.close()));
  await home.cleanup();
});

function forwarded(auth: Response): Headers {
  const headers = new Headers();
  for (const [name, value] of auth.headers) {
    if (name.startsWith('x-middleware-request-')) headers.set(name.slice('x-middleware-request-'.length), value);
  }
  return headers;
}

/** Ri as one origin: the well-known routes (outside the proxy), then the proxy and the route behind it. */
async function serve(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new NextRequest(input instanceof Request ? input : String(input), { ...init, signal: init?.signal ?? undefined });
  const path = request.nextUrl.pathname;
  if (path === '/.well-known/oauth-authorization-server') return (await import('@/app/.well-known/oauth-authorization-server/route')).GET(request);
  if (path.startsWith('/.well-known/oauth-protected-resource')) {
    const resource = path.slice('/.well-known/oauth-protected-resource'.length).split('/').filter(Boolean);
    return (await import('@/app/.well-known/oauth-protected-resource/[[...resource]]/route')).GET(request, { params: Promise.resolve({ resource: resource.length ? resource : undefined }) });
  }
  const { proxy } = await import('@/proxy');
  const auth = proxy(request);
  if (auth.headers.get('x-middleware-next') !== '1') return auth;
  const next = new NextRequest(request, { headers: forwarded(auth) });
  if (path === HOME_MCP_PATH) return (await import('@/app/api/orchestrator/[transport]/route'))[request.method as 'GET' | 'POST' | 'DELETE'](next);
  const routes: Record<string, () => Promise<{ POST(request: Request): Promise<Response> }>> = {
    '/api/oauth/register': () => import('@/app/api/oauth/register/route'),
    '/api/oauth/token': () => import('@/app/api/oauth/token/route'),
    '/api/oauth/revoke': () => import('@/app/api/oauth/revoke/route'),
    '/api/oauth/authorize': () => import('@/app/api/oauth/authorize/route'),
  };
  if (!routes[path]) throw new Error(`No route for ${path} in this test`);
  return (await routes[path]()).POST(next);
}

/** The owner on the consent page: the page's hidden fields, posted with the browser's cookie from Ri's own origin. */
async function decide(authorizationUrl: URL, decision: 'allow' | 'deny' = 'allow', headers: Record<string, string> = {}): Promise<Response> {
  const form = new URLSearchParams();
  for (const field of AUTHORIZE_FIELDS) {
    const value = authorizationUrl.searchParams.get(field);
    if (value !== null) form.set(field, value);
  }
  form.set('decision', decision);
  return serve(`${BASE}/api/oauth/authorize`, {
    method: 'POST', body: form.toString(),
    headers: { cookie: `ri_session=${viewer}`, origin: BASE, 'content-type': 'application/x-www-form-urlencoded', ...headers },
  });
}

async function approve(authorizationUrl: URL): Promise<URL> {
  const response = await decide(authorizationUrl);
  expect(response.status).toBe(303);
  return new URL(response.headers.get('location')!);
}

interface TestProvider extends OAuthClientProvider { authorizationUrl?: URL }
function provider(options: { metadataUrl?: string; name?: string } = {}): TestProvider {
  let info: Awaited<ReturnType<OAuthClientProvider['clientInformation']>>;
  let tokens: Awaited<ReturnType<OAuthClientProvider['tokens']>>;
  let verifier = '';
  const self: TestProvider = {
    get redirectUrl() { return CALLBACK; },
    ...(options.metadataUrl ? { clientMetadataUrl: options.metadataUrl } : {}),
    get clientMetadata() {
      return { client_name: options.name ?? 'Test Assistant', redirect_uris: [CALLBACK], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
    },
    clientInformation: () => info,
    saveClientInformation: value => { info = value; },
    tokens: () => tokens,
    saveTokens: value => { tokens = value; },
    redirectToAuthorization: url => { self.authorizationUrl = url; },
    saveCodeVerifier: value => { verifier = value; },
    codeVerifier: () => verifier,
    state: () => 'state-123',
  };
  return self;
}

/** The SDK's whole flow: discover, register or use the document, send the owner to Ri, exchange the code, connect. */
async function signIn(p: TestProvider): Promise<Client> {
  const first = new Client({ name: 'outside-assistant', version: '1.0.0' });
  await expect(first.connect(new StreamableHTTPClientTransport(new URL(MCP), { authProvider: p, fetch: serve as typeof fetch }))).rejects.toBeInstanceOf(UnauthorizedError);
  const transport = new StreamableHTTPClientTransport(new URL(MCP), { authProvider: p, fetch: serve as typeof fetch });
  const callback = await approve(p.authorizationUrl!);
  expect(callback.origin + callback.pathname).toBe(CALLBACK);
  expect(callback.searchParams.get('state')).toBe('state-123');
  await transport.finishAuth(callback.searchParams);
  const client = new Client({ name: 'outside-assistant', version: '1.0.0' });
  clients.push(client);
  await client.connect(transport);
  return client;
}

async function personalClients() {
  const q = await import('@/lib/db/queries');
  return q.listPersonalAiClients();
}

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

async function token(form: Record<string, string>, headers: Record<string, string> = {}) {
  const response = await serve(`${BASE}/api/oauth/token`, { method: 'POST', body: new URLSearchParams(form).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers } });
  return { status: response.status, body: await response.json() as Record<string, string>, headers: response.headers };
}

/** A client that does the steps by hand, the way ChatGPT does with its metadata document. */
async function authorizeByHand(clientId: string, redirectUri: string) {
  const { verifier, challenge } = pkce();
  const url = new URL(`${BASE}/oauth/authorize`);
  url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: MCP, scope: 'content' }).toString();
  const callback = await approve(url);
  return { verifier, code: callback.searchParams.get('code')!, callback };
}

describe('discovery', () => {
  it('challenges an MCP client without a working key with where to sign in, and leaves other refusals plain', async () => {
    const none = await serve(MCP, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource${HOME_MCP_PATH}", scope="content"`);
    const wrong = await serve(MCP, { method: 'POST', body: '{}', headers: { authorization: 'Bearer ri_live_nope', 'content-type': 'application/json' } });
    expect(wrong.headers.get('www-authenticate')).toContain('error="invalid_token"');
    const elsewhere = await serve(`${BASE}/api/tasks`);
    expect(elsewhere.status).toBe(401);
    expect(elsewhere.headers.get('www-authenticate')).toBeNull();
  });

  it('publishes metadata whose issuer and resource are the address the client used, never a forged host', async () => {
    const resource = await (await serve(`${BASE}/.well-known/oauth-protected-resource${HOME_MCP_PATH}`)).json();
    expect(resource).toMatchObject({ resource: MCP, authorization_servers: [BASE], scopes_supported: ['content'] });
    const server = await serve(`${BASE}/.well-known/oauth-authorization-server`);
    expect(server.headers.get('access-control-allow-origin')).toBe('*');
    expect(await server.json()).toMatchObject({
      issuer: BASE, authorization_endpoint: `${BASE}/oauth/authorize`, token_endpoint: `${BASE}/api/oauth/token`,
      registration_endpoint: `${BASE}/api/oauth/register`, code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true,
    });
    const forged = await (await serve(`${BASE}/.well-known/oauth-authorization-server`, { headers: { host: 'evil.example' } })).json();
    expect(forged.issuer).toBe(BASE);
    expect((await serve(`${BASE}/.well-known/oauth-protected-resource/api/tasks`)).status).toBe(404);
  });
});

describe('signing in', () => {
  it('connects a client that registers itself, and files its key like any other', async () => {
    const client = await signIn(provider({ name: 'Test Assistant' }));
    const tools = (await client.listTools()).tools.map(tool => tool.name);
    expect(tools).toEqual(expect.arrayContaining(['list_tasks', 'show_deck', 'show_tasks']));
    expect(tools).not.toContain('delegate_work');
    const created = await client.callTool({ name: 'create_task', arguments: { title: 'Ship the OAuth sign-in', rawInput: 'Ship the OAuth sign-in' } });
    expect(created.isError).toBeFalsy();
    const keys = await personalClients();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ name: 'Test Assistant', client: 'other' });
    expect(keys[0].lastUsedAt).not.toBeNull();
  });

  it('connects a client by its metadata document, without registering', async () => {
    const metadataUrl = 'https://assistant.example/oauth/client.json';
    const fetched: string[] = [];
    (await import('./clients')).setMetadataFetchForTests(async url => {
      fetched.push(url);
      return { status: 200, body: JSON.stringify({ client_id: metadataUrl, client_name: 'Doc Assistant', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' }) };
    });
    const p = provider({ metadataUrl });
    const client = await signIn(p);
    expect(p.authorizationUrl!.searchParams.get('client_id')).toBe(metadataUrl);
    expect(fetched).toEqual([metadataUrl]);
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    expect(await personalClients()).toMatchObject([{ name: 'Doc Assistant', client: 'other' }]);
  });

  it('connects ChatGPT exactly as its published client document describes it, and lets it revoke itself', async () => {
    const chatgpt = 'https://chatgpt.com/oauth/client.json';
    const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
    (await import('./clients')).setMetadataFetchForTests(async () => ({ status: 200, body: JSON.stringify({
      client_id: chatgpt, client_uri: 'https://chatgpt.com/', redirect_uris: [redirect], token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      client_name: 'ChatGPT', logo_uri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png', token_endpoint_auth_signing_alg: 'RS256', jwks_uri: 'https://chatgpt.com/oauth/jwks.json',
    }) }));
    const { verifier, code, callback } = await authorizeByHand(chatgpt, redirect);
    expect(callback.origin + callback.pathname).toBe(redirect);
    expect(callback.searchParams.get('iss')).toBe(BASE);
    expect(callback.searchParams.get('state')).toBe('xyz');
    const issued = await token({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: chatgpt, code_verifier: verifier, resource: MCP });
    expect(issued.status).toBe(200);
    expect(issued.headers.get('cache-control')).toBe('no-store');
    expect(issued.body).toMatchObject({ token_type: 'Bearer', scope: 'content' });
    expect(await personalClients()).toMatchObject([{ name: 'ChatGPT', client: 'chatgpt' }]);

    const client = new Client({ name: 'chatgpt', version: '1.0.0' });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP), { fetch: serve as typeof fetch, requestInit: { headers: { authorization: `Bearer ${issued.body.access_token}` } } }));
    expect((await client.listTools()).tools.map(tool => tool.name)).toContain('show_deck');

    const revoked = await serve(`${BASE}/api/oauth/revoke`, { method: 'POST', body: new URLSearchParams({ token: issued.body.access_token }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(revoked.status).toBe(200);
    expect(await personalClients()).toEqual([]);
    const after = await serve(MCP, { method: 'POST', body: '{}', headers: { authorization: `Bearer ${issued.body.access_token}`, 'content-type': 'application/json' } });
    expect(after.status).toBe(401);
  });

  it('authenticates a confidential client with the secret it was registered with', async () => {
    const registered = await (await serve(`${BASE}/api/oauth/register`, { method: 'POST', body: JSON.stringify({ client_name: 'Server Agent', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_basic' }) })).json();
    expect(registered.client_secret).toBeTruthy();
    const basic = (secret: string) => `Basic ${Buffer.from(`${encodeURIComponent(registered.client_id)}:${encodeURIComponent(secret)}`).toString('base64')}`;
    const first = await authorizeByHand(registered.client_id, CALLBACK);
    const refused = await token({ grant_type: 'authorization_code', code: first.code, redirect_uri: CALLBACK, code_verifier: first.verifier }, { authorization: basic('wrong') });
    expect(refused).toMatchObject({ status: 401, body: { error: 'invalid_client' } });
    const second = await authorizeByHand(registered.client_id, CALLBACK);
    const issued = await token({ grant_type: 'authorization_code', code: second.code, redirect_uri: CALLBACK, code_verifier: second.verifier }, { authorization: basic(registered.client_secret) });
    expect(issued.status).toBe(200);
    expect(await personalClients()).toMatchObject([{ name: 'Server Agent' }]);
  });
});

describe('refusals', () => {
  async function registered(redirect = CALLBACK) {
    return (await serve(`${BASE}/api/oauth/register`, { method: 'POST', body: JSON.stringify({ client_name: 'Assistant', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }) })).json() as Promise<{ client_id: string }>;
  }

  it('uses a code once, only with its own verifier, client and redirect', async () => {
    const { client_id } = await registered();
    const bad = await authorizeByHand(client_id, CALLBACK);
    expect(await token({ grant_type: 'authorization_code', code: bad.code, redirect_uri: CALLBACK, client_id, code_verifier: pkce().verifier })).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    // A wrong verifier spent the code.
    expect(await token({ grant_type: 'authorization_code', code: bad.code, redirect_uri: CALLBACK, client_id, code_verifier: bad.verifier })).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    const other = await registered('https://other.example/cb');
    const stolen = await authorizeByHand(client_id, CALLBACK);
    expect(await token({ grant_type: 'authorization_code', code: stolen.code, redirect_uri: CALLBACK, client_id: other.client_id, code_verifier: stolen.verifier })).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    const good = await authorizeByHand(client_id, CALLBACK);
    expect((await token({ grant_type: 'authorization_code', code: good.code, redirect_uri: CALLBACK, client_id, code_verifier: good.verifier })).status).toBe(200);
    expect((await token({ grant_type: 'authorization_code', code: good.code, redirect_uri: CALLBACK, client_id, code_verifier: good.verifier })).body.error).toBe('invalid_grant');
    expect(await personalClients()).toHaveLength(1);
  });

  it('takes a code only at the address where it was approved', async () => {
    const { client_id } = await registered();
    const { issueCode, exchangeToken } = await import('./flow');
    const { verifier, challenge } = pkce();
    const code = issueCode({ clientId: client_id, clientName: 'Assistant', kind: 'other', redirectUri: CALLBACK, codeChallenge: challenge, resource: `http://localhost:4224${HOME_MCP_PATH}`, issuer: 'http://localhost:4224' });
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, client_id, redirect_uri: CALLBACK, code_verifier: verifier });
    expect(exchangeToken(form, null, BASE)).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    expect(await personalClients()).toEqual([]);
  });

  it('sends Cancel back as access_denied, with the issuer, and makes no key', async () => {
    const { client_id } = await registered();
    const { challenge } = pkce();
    const url = new URL(`${BASE}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 's' })}`);
    const response = await decide(url, 'deny');
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(CALLBACK);
    expect(Object.fromEntries(location.searchParams)).toMatchObject({ error: 'access_denied', state: 's', iss: BASE });
    expect(await personalClients()).toEqual([]);
  });

  it('never sends the browser to a redirect the client didn’t register', async () => {
    const { client_id } = await registered();
    const { challenge } = pkce();
    const url = new URL(`${BASE}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id, redirect_uri: 'https://evil.example/steal', code_challenge: challenge, code_challenge_method: 'S256' })}`);
    const response = await decide(url);
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('location')!).origin + new URL(response.headers.get('location')!).pathname).toBe(`${BASE}/oauth/authorize`);
    const { checkAuthorizeRequest } = await import('./flow');
    expect(await checkAuthorizeRequest(url.searchParams, BASE)).toMatchObject({ kind: 'fatal' });
  });

  it('returns a request error to a registered redirect, with the issuer', async () => {
    const { client_id } = await registered();
    const { checkAuthorizeRequest } = await import('./flow');
    const noPkce = await checkAuthorizeRequest(new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CALLBACK, state: 's' }), BASE);
    // The page shows it with a link back, and never sends the browser there unasked.
    expect(noPkce).toMatchObject({ kind: 'redirect', description: 'Send a PKCE code_challenge.' });
    const location = new URL((noPkce as { location: string }).location);
    expect(Object.fromEntries(location.searchParams)).toMatchObject({ error: 'invalid_request', state: 's', iss: BASE });
    const elsewhere = await checkAuthorizeRequest(new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CALLBACK, code_challenge: pkce().challenge, code_challenge_method: 'S256', resource: 'https://other.example/mcp' }), BASE);
    expect(new URL((elsewhere as { location: string }).location).searchParams.get('error')).toBe('invalid_target');
  });

  it('takes the owner’s choice only from a signed-in browser on Ri’s own page', async () => {
    const { client_id } = await registered();
    const url = new URL(`${BASE}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CALLBACK, code_challenge: pkce().challenge, code_challenge_method: 'S256' })}`);
    expect((await decide(url, 'allow', { cookie: '' })).status).toBe(401);
    expect((await decide(url, 'allow', { origin: 'https://evil.example' })).status).toBe(403);
    const q = await import('@/lib/db/queries');
    const assistant = q.createPersonalAiClient('Codex', 'codex').token.plaintext;
    expect((await decide(url, 'allow', { cookie: `ri_session=${assistant}` })).status).toBe(403);
    expect(await personalClients()).toHaveLength(1);
  });

  it('keeps the page out of frames and lets its form carry Ri’s origin, which the proxy needs', async () => {
    const config = (await import('../../../next.config')).default;
    const rule = (await config.headers!()).find(entry => entry.source === '/oauth/:path*')!;
    const headers = Object.fromEntries(rule.headers.map(header => [header.key, header.value]));
    expect(headers).toMatchObject({ 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'", 'Cache-Control': 'no-store' });
    // Under no-referrer a browser posts the form with `Origin: null`, and the proxy refuses it, as it must.
    expect(headers['Referrer-Policy']).toBe('same-origin');
    const { client_id } = await registered();
    const url = new URL(`${BASE}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CALLBACK, code_challenge: pkce().challenge, code_challenge_method: 'S256' })}`);
    expect((await decide(url, 'allow', { origin: 'null' })).status).toBe(403);
  });

  it('registers only redirects that can’t be turned against the owner', async () => {
    const register = async (redirect_uris: unknown) => (await serve(`${BASE}/api/oauth/register`, { method: 'POST', body: JSON.stringify({ redirect_uris, token_endpoint_auth_method: 'none' }) })).json();
    expect(await register(['http://attacker.example/cb'])).toMatchObject({ error: 'invalid_redirect_uri' });
    expect(await register(['javascript:alert(1)'])).toMatchObject({ error: 'invalid_redirect_uri' });
    expect(await register(['https://client.example/cb#frag'])).toMatchObject({ error: 'invalid_redirect_uri' });
    expect(await register([])).toMatchObject({ error: 'invalid_redirect_uri' });
    expect(await register(['http://127.0.0.1:43123/callback', 'cursor://anysphere.cursor-retrieval/oauth/callback'])).toMatchObject({ token_endpoint_auth_method: 'none' });
  });
});
