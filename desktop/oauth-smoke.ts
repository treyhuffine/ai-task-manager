/** Packaged OAuth integration with disposable app/OS homes and local mock providers.
 * Protocol dispatch is emitted inside Electron. No real consent page, tunnel or external account is used.
 * RI_DESKTOP_PACKAGE=... pnpm exec tsx desktop/oauth-smoke.ts */
import assert from 'node:assert/strict';
import https from 'node:https';
import path from 'node:path';
import { acceptance, api, bounded, eventually } from './acceptance-fixture';
import { mockMcp } from './mock-mcp';
import { readCaCertPem } from '../src/lib/config/tls';
import { serviceRequest, type ServiceSession } from '../src/lib/service/client';

interface Authorization {
  entry?: { id: string };
  requiresAuth: boolean;
  authUrl?: string;
  desktopFlowId?: string;
}
interface AppResponse { status: number; location?: string; text: string }

void acceptance('oauth-smoke', async fixture => {
  // The test uses only dynamically registered mock clients, never inherited BYO clients.
  for (const key of new Set([...Object.keys(fixture.env), ...Object.keys(process.env)])) {
    if (/^(?:INTEGRATIONS_|GOOGLE_CLIENT_|RI_DESKTOP_OAUTH_RELAY)/.test(key)) {
      delete fixture.env[key]; delete process.env[key];
    }
  }
  const providers: Awaited<ReturnType<typeof mockMcp>>[] = [];
  try {
    const page = await fixture.launch();
    const app = fixture.app!;
    const origin = fixture.origin!;
    const session = await serviceRequest<ServiceSession>('/session');
    assert(session.origin === origin, 'Control socket returned a different fixture origin');
    const ca = readCaCertPem();
    assert(ca, 'Fixture CA was not created');

    // This independent HTTPS client cannot receive Electron's private capability.
    // It never follows Location and admits only the current fixture origin.
    const requestApp = (route: string, options: { method?: string; body?: unknown; origin?: string } = {}) => {
      const target = new URL(route, origin);
      assert(target.origin === origin, 'OAuth acceptance request left its fixture origin');
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      return new Promise<AppResponse>((resolve, reject) => {
        const request = https.request(target, {
          ca, agent: false, method: options.method ?? 'GET',
          headers: {
            authorization: `Bearer ${session.token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(options.origin ? { origin: options.origin, 'sec-fetch-site': 'same-origin' } : {}),
          },
        }, response => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 1_048_576) request.destroy(new Error('OAuth acceptance response exceeded its bound'));
            else chunks.push(chunk);
          });
          response.on('end', () => resolve({ status: response.statusCode ?? 0, location: response.headers.location, text: Buffer.concat(chunks).toString() }));
          response.on('error', reject);
        });
        request.setTimeout(30_000, () => request.destroy(new Error('OAuth acceptance request timed out')));
        request.on('error', reject);
        request.end(body);
      });
    };

    const newProvider = async () => { const provider = await mockMcp(); providers.push(provider); return provider; };
    const consent = async (result: Authorization, provider: Awaited<ReturnType<typeof mockMcp>>) => {
      assert(result.requiresAuth && result.authUrl, 'MCP did not start an authorization');
      const authorization = new URL(result.authUrl);
      assert(authorization.origin === new URL(provider.url).origin, 'Authorization escaped the local mock provider');
      assert(authorization.searchParams.get('code_challenge_method') === 'S256', 'MCP authorization omitted PKCE S256');
      assert(authorization.searchParams.get('state'), 'MCP authorization omitted state');
      const response = await fetch(authorization, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 302, 'Mock consent did not redirect');
      const location = response.headers.get('location');
      assert(location, 'Mock consent omitted its callback');
      return new URL(location);
    };
    const connectedServer = async (id: string) => {
      const status = await requestApp('/api/integrations/mcp-servers');
      assert.equal(status.status, 200, 'Could not read fixture MCP status');
      const { servers } = JSON.parse(status.text) as { servers: { id: string; lastStatus?: string }[] };
      return servers.some(server => server.id === id && server.lastStatus === 'ok');
    };

    const nativeProvider = await newProvider();
    const native = await api<Authorization>(page, '/api/integrations/mcp-servers', 'POST', {
      name: 'Native OAuth fixture', url: nativeProvider.url, auth: { kind: 'oauth' },
    });
    assert(native.desktopFlowId && native.entry, 'Trusted renderer did not receive a native flow');
    const callback = await consent(native, nativeProvider);
    assert(callback.protocol === 'http:' && callback.hostname === '127.0.0.1' && callback.pathname === '/oauth/callback', 'Native OAuth did not choose a loopback listener');
    assert(nativeProvider.registrations.length > 0, 'Native OAuth skipped dynamic client registration');
    const webAttempt = await requestApp(`/api/integrations/mcp-oauth/${native.entry.id}${callback.search}`);
    assert.equal(webAttempt.status, 400, 'Public web callback accepted native OAuth state');
    assert.equal(nativeProvider.exchanges, 0, 'Rejected web callback exchanged the native code');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    assert.equal((await fetch(callback, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })).status, 200);
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('settings') === 'plugins');
    await page.locator('p').filter({ hasText: /^Connected$/ }).waitFor();
    await eventually(async () => connectedServer(native.entry!.id), 'native MCP tools ingested');
    assert.equal(nativeProvider.exchanges, 1, 'Native callback did not exchange exactly once');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), false);
    fixture.check('Native discovery, DCR and PKCE complete through loopback after the public web callback rejects the same state');

    await fixture.navigate('/');
    const again = await api<Authorization>(page, `/api/integrations/mcp-servers/${native.entry.id}`, 'POST', {});
    assert(again.desktopFlowId, 'Native reconnect did not create a desktop flow');
    const againCallback = await consent(again, nativeProvider);
    const deepLink = `ri://oauth/callback?${againCallback.searchParams}`;
    await bounded(app.evaluate(({ app }, url) => { app.emit('open-url', { preventDefault() {} }, url); }, deepLink), 'native OAuth protocol event');
    await eventually(async () => nativeProvider.exchanges === 2, 'custom-protocol token exchange');
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('settings') === 'plugins');
    await page.locator('p').filter({ hasText: /^Connected$/ }).waitFor();
    await bounded(app.evaluate(({ app }, url) => { app.emit('open-url', { preventDefault() {} }, url); }, deepLink), 'replayed OAuth protocol event');
    const replay = await page.evaluate(async body => {
      const response = await fetch('/api/desktop/oauth/complete', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
        signal: AbortSignal.timeout(10_000),
      });
      return response.status;
    }, againCallback.searchParams.toString());
    assert.equal(replay, 400, 'Consumed custom-protocol callback was accepted again');
    assert.equal(nativeProvider.exchanges, 2, 'Callback replay exchanged twice');
    fixture.check('Native reconnect completes through the Electron open-url event and replay is rejected without another exchange');

    const webFlow = async (name: string, startingOrigin?: string) => {
      const provider = await newProvider();
      const response = await requestApp('/api/integrations/mcp-servers', {
        method: 'POST', origin: startingOrigin,
        body: { name, url: provider.url, auth: { kind: 'oauth' } },
      });
      assert.equal(response.status, 201, 'Ordinary owner MCP initiation failed');
      const result = JSON.parse(response.text) as Authorization;
      assert(!result.desktopFlowId && result.entry, 'Ordinary owner client received a native callback');
      const callback = await consent(result, provider);
      assert(callback.origin === origin && callback.pathname === `/api/integrations/mcp-oauth/${result.entry.id}`, 'Web OAuth callback did not target the fixture service');
      const completed = await requestApp(`${callback.pathname}${callback.search}`);
      assert.equal(completed.status, 307, 'Web OAuth callback did not return a redirect');
      assert.equal(provider.exchanges, 1, 'Web OAuth did not exchange exactly once');
      await eventually(async () => connectedServer(result.entry!.id), 'web MCP tools ingested');
      return completed;
    };

    // Origin is metadata for the return target. Every network request still
    // goes to the fixture or a local mock, and redirects are never followed.
    const remoteOrigin = 'https://remote.example';
    const remote = await webFlow('Remote origin fixture', remoteOrigin);
    assert(remote.location, 'Web callback omitted its return location');
    const remoteReturn = new URL(remote.location);
    assert(remoteReturn.origin === remoteOrigin, 'Web callback lost the initiating public origin');
    assert(remoteReturn.searchParams.get('connected') === 'Remote origin fixture', 'Remote web callback did not report success');
    fixture.check('Owner-only web initiation stays on the web channel and returns to its recorded remote origin through the production HTTPS gateway');

    const fallback = await webFlow('Relative return fixture');
    assert(fallback.location, 'Unrecorded starting origin omitted its return location');
    assert(fallback.location.startsWith('/?settings=plugins&connected='), 'Unrecorded starting origin did not produce a relative return');
    assert(new URL(fallback.location, origin).origin === origin, 'Relative callback escaped its browser origin');
    fixture.check('Web initiation without browser-origin metadata uses a relative callback return');

    await fixture.navigate('/?settings=plugins');
    await page.getByText('Relative return fixture', { exact: true }).first().waitFor();
    await page.screenshot({ path: path.join(fixture.base, 'oauth-connections.png') });
    fixture.report.limits = ['OAuth providers and consent are local mocks. Custom-protocol dispatch is emitted directly inside Electron. Normal packaged startup may register its protocol within the isolated Linux home. No live provider registration, external tunnel, phone browser or OS deep-link delivery is qualified.'];
  } finally { providers.forEach(provider => provider.close()); }
}).catch(error => { console.error(error); process.exitCode = 1; });
