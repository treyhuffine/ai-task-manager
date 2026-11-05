import { describe, expect, it, vi } from 'vitest';
import { clientKindFor, clientLabel, kindFor, publicLookup, type MetadataFetch, isAllowedRedirectUri, isMetadataClientId, redirectMatches, registerClient, registeredClientSecret, resolveClient, secretMatches, tokenClient, OAuthClientError, RegistrationError } from './clients';
import { issuerFor, mcpChallenge } from './issuer';

const SECRET = 'home-local-token';

function documentFetch(body: unknown, status = 200) {
  return vi.fn<MetadataFetch>(async () => ({ status, body: typeof body === 'string' ? body : JSON.stringify(body) }));
}

describe('redirects', () => {
  it('allows HTTPS, HTTP only to this computer, and an app’s own scheme', () => {
    expect(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:3334/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:43123/callback')).toBe(true);
    expect(isAllowedRedirectUri('cursor://anysphere.cursor-retrieval/oauth/user-ri/callback')).toBe(true);
    for (const bad of ['http://example.com/cb', 'javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'https://a.example/cb#x', 'not a url', 42]) {
      expect(isAllowedRedirectUri(bad), String(bad)).toBe(false);
    }
  });

  it('matches exactly, except that a loopback IP listener may choose its port', () => {
    expect(redirectMatches(['https://a.example/cb'], 'https://a.example/cb')).toBe(true);
    expect(redirectMatches(['https://a.example/cb'], 'https://a.example/cb2')).toBe(false);
    expect(redirectMatches(['http://127.0.0.1:1000/cb'], 'http://127.0.0.1:52011/cb')).toBe(true);
    expect(redirectMatches(['http://127.0.0.1:1000/cb'], 'http://127.0.0.1:52011/other')).toBe(false);
    // A name isn't an IP literal (RFC 8252 §8.3), so it keeps its port.
    expect(redirectMatches(['http://localhost:1000/cb'], 'http://localhost:2000/cb')).toBe(false);
  });
});

describe('registration', () => {
  it('stores nothing: the ID carries the registration, and a confidential client’s secret is derived from it', async () => {
    const registered = registerClient({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'client_secret_post' }, SECRET);
    expect(registered).toMatchObject({ client_name: 'Claude', token_endpoint_auth_method: 'client_secret_post', grant_types: ['authorization_code'] });
    expect(registered.client_secret).toBe(registeredClientSecret(registered.client_id, SECRET));
    expect(secretMatches(registered.client_id, registered.client_secret!, SECRET)).toBe(true);
    expect(secretMatches(registered.client_id, 'nope', SECRET)).toBe(false);
    const client = await resolveClient(registered.client_id);
    expect(client).toMatchObject({ name: 'Claude', source: 'registered', host: null, authMethod: 'client_secret_post' });
    expect(kindFor(client, 'https://claude.ai/api/mcp/auth_callback')).toBe('claude_desktop');
    expect(tokenClient(registered.client_id)).toMatchObject({ authMethod: 'client_secret_post' });
    expect(clientLabel(registered.client_id)).toBe('Claude');
  });

  it('defaults to client_secret_basic, as RFC 7591 says, and gives a public client no secret', () => {
    expect(registerClient({ redirect_uris: ['https://a.example/cb'] }, SECRET)).toMatchObject({ token_endpoint_auth_method: 'client_secret_basic', client_secret: expect.any(String) });
    expect(registerClient({ redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'none' }, SECRET).client_secret).toBeUndefined();
  });

  it('refuses what Ri can’t honor', () => {
    expect(() => registerClient({ redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'private_key_jwt' }, SECRET)).toThrow(RegistrationError);
    expect(() => registerClient({ redirect_uris: ['https://a.example/cb'], grant_types: ['client_credentials'] }, SECRET)).toThrow(/authorization_code/);
    expect(() => registerClient({ redirect_uris: ['https://a.example/cb'], response_types: ['token'] }, SECRET)).toThrow(/code/);
    expect(() => registerClient({ redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`) }, SECRET)).toThrow(/between 1 and 10/);
    expect(() => registerClient('nope', SECRET)).toThrow(RegistrationError);
  });

  it('cleans a name of anything that could pass for layout or another app', async () => {
    const registered = registerClient({ client_name: '  Chat‮GPT\n\u0007  helper  ', redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'none' }, SECRET);
    expect(registered.client_name).toBe('ChatGPT helper');
    expect((await resolveClient(registerClient({ redirect_uris: ['https://tool.example/cb'], token_endpoint_auth_method: 'none' }, SECRET).client_id)).name).toBe('tool.example');
  });

  it('knows a forged or unknown ID for what it is', async () => {
    await expect(resolveClient('ri_oauth_bm9wZQ')).rejects.toBeInstanceOf(OAuthClientError);
    await expect(resolveClient('some-client')).rejects.toBeInstanceOf(OAuthClientError);
    await expect(resolveClient(null)).rejects.toBeInstanceOf(OAuthClientError);
    expect(tokenClient('some-client')).toBeNull();
  });
});

describe('metadata documents', () => {
  const url = 'https://app.example/oauth/client.json';

  it('reads a public HTTPS document with a path, never this computer’s network', () => {
    expect(isMetadataClientId(url)).toBe(true);
    for (const bad of ['https://app.example/', 'http://app.example/client.json', 'https://localhost/c.json', 'https://127.0.0.1/c.json', 'https://10.0.0.5/c.json', 'https://192.168.1.2/c.json', 'https://[::1]/c.json', 'https://printer.local/c.json', 'https://intranet/c.json', 'https://u:p@app.example/c.json']) {
      expect(isMetadataClientId(bad), bad).toBe(false);
    }
  });

  it('takes the client from the document, once, without following redirects', async () => {
    const fetchImpl = documentFetch({ client_id: `${url}?v=1`.replace('?v=1', ''), client_name: 'App', redirect_uris: ['https://app.example/cb'], token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'] });
    const client = await resolveClient(url, fetchImpl);
    expect(client).toMatchObject({ id: url, name: 'App', host: 'app.example', source: 'metadata', authMethod: 'none' });
    expect(kindFor(client, 'https://chatgpt.com/cb')).toBe('other');
    expect(fetchImpl).toHaveBeenCalledWith(url);
    await resolveClient(url, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses a document that names another client, lists no usable redirect, can’t be a public client or is too big', async () => {
    const other = 'https://other.example/a.json';
    await expect(resolveClient(other, documentFetch({ client_id: 'https://else.example/a.json', redirect_uris: ['https://x.example/cb'] }))).rejects.toThrow(/different client/);
    await expect(resolveClient('https://other.example/b.json', documentFetch({ client_id: 'https://other.example/b.json', redirect_uris: ['http://x.example/cb'] }))).rejects.toThrow(/no redirect/);
    await expect(resolveClient('https://other.example/c.json', documentFetch({ client_id: 'https://other.example/c.json', redirect_uris: ['https://x.example/cb'], token_endpoint_auth_method: 'private_key_jwt' }))).rejects.toThrow(/method/);
    await expect(resolveClient('https://other.example/d.json', documentFetch('x'.repeat(70_000)))).rejects.toThrow(/too large/);
    await expect(resolveClient('https://other.example/e.json', documentFetch('{}', 404))).rejects.toThrow(/404/);
    await expect(resolveClient('https://other.example/g.json', documentFetch('{}', 302))).rejects.toThrow(/302/);
    await expect(resolveClient('https://other.example/f.json', vi.fn<MetadataFetch>(async () => { throw new Error('ECONNREFUSED'); }))).rejects.toThrow(/couldn’t read/);
  });

  it('refuses a public name that resolves to this computer or its network, where the socket connects', async () => {
    const answer = (address: string | Array<{ address: string; family: number }>) => publicLookup((_host, _options, callback) => callback(null, address, 4));
    const lookup = (resolve: ReturnType<typeof publicLookup>) => new Promise<NodeJS.ErrnoException | null>(done => resolve('rebind.example', {}, error => done(error)));
    expect(await lookup(answer('192.168.1.1'))).toMatchObject({ code: 'EPRIVATE' });
    expect(await lookup(answer('127.0.0.1'))).toMatchObject({ code: 'EPRIVATE' });
    expect(await lookup(answer([{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }]))).toMatchObject({ code: 'EPRIVATE' });
    expect(await lookup(answer('93.184.216.34'))).toBeNull();
    expect(await lookup(answer([{ address: '2606:2800:220:1::1', family: 6 }]))).toBeNull();
  });

  it('knows an app by the host that proved it, never by the name it gives', () => {
    expect(clientKindFor('chatgpt.com')).toBe('chatgpt');
    expect(clientKindFor('claude.ai')).toBe('claude_desktop');
    expect(clientKindFor('evil-chatgpt.com')).toBe('other');
    expect(clientKindFor(null)).toBe('other');
    const named = { host: null };
    // A registered client called ChatGPT is ChatGPT only when its code goes back to chatgpt.com.
    expect(kindFor(named, 'https://chatgpt.com/connector_platform_oauth_redirect')).toBe('chatgpt');
    expect(kindFor(named, 'https://evil.example/cb')).toBe('other');
    expect(kindFor(named, 'http://127.0.0.1:4000/cb')).toBe('other');
    expect(clientLabel(url)).toBe('app.example');
  });
});

describe('issuer', () => {
  const bases = { remote: 'https://ri-trey.beamd.run', local: 'http://localhost:4224' };
  const headers = (host: string) => new Headers({ host });

  it('is the Home address the request reached, its loopback aliases included', () => {
    expect(issuerFor(headers('ri-trey.beamd.run'), 'http://internal/', bases)).toBe('https://ri-trey.beamd.run');
    expect(issuerFor(headers('localhost:4224'), 'http://localhost:4224/', bases)).toBe('http://localhost:4224');
    expect(issuerFor(headers('127.0.0.1:4224'), 'http://127.0.0.1:4224/', bases)).toBe('http://127.0.0.1:4224');
  });

  it('never takes an unknown host from the caller', () => {
    expect(issuerFor(headers('evil.example'), 'http://evil.example/', bases)).toBe('https://ri-trey.beamd.run');
    expect(issuerFor(headers('127.0.0.1:9999'), 'http://127.0.0.1:9999/', bases)).toBe('https://ri-trey.beamd.run');
    expect(issuerFor(headers('evil.example'), 'http://evil.example/', { remote: null, local: bases.local })).toBe('http://localhost:4224');
  });

  it('challenges with the resource metadata on the same origin', () => {
    expect(mcpChallenge('https://ri.example', 'invalid_token')).toBe('Bearer resource_metadata="https://ri.example/.well-known/oauth-protected-resource/api/orchestrator/mcp", scope="content", error="invalid_token"');
  });
});
