/**
 * Microsoft 365 (Graph) connector — OAuth2 connect + Outlook mail/calendar actions over a fake
 * Graph backend. Mirrors the OAuth2 setup style from auth-config.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { registerMicrosoft, MICROSOFT_SCOPES } from '../providers/microsoft';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';

const RU = 'http://127.0.0.1/cb';
const SCOPES = [
  'openid',
  'email',
  'offline_access',
  MICROSOFT_SCOPES.userRead,
  MICROSOFT_SCOPES.mailRead,
  MICROSOFT_SCOPES.mailSend,
  MICROSOFT_SCOPES.calendarsReadWrite,
];

function setup() {
  const env = { action: (_c: FakeHttpCall) => ({ json: {} as unknown, status: 200 as number | undefined }) };
  const http = fakeHttp(async (call) => {
    if (call.url.startsWith('https://login.microsoftonline.com')) {
      return { json: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: SCOPES.join(' ') } };
    }
    if (call.url.endsWith('/v1.0/me')) {
      return { json: { id: 'u1', mail: 'me@contoso.com', displayName: 'Me' } };
    }
    return env.action(call);
  });
  const registry = createRegistry();
  registerMicrosoft(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([
      { id: 'microsoft', providerId: 'microsoft', scheme: 'oauth2', scope: 'global', oauth: { clientId: 'c', redirectUri: RU }, clientSecret: 's', status: 'active' },
    ]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime, store, http, env };
}

async function connect(s: ReturnType<typeof setup>) {
  const begin = await s.runtime.beginAuth('microsoft', { scopes: SCOPES });
  return s.runtime.completeAuth({ code: 'code', state: begin.requestId });
}

describe('microsoft 365 connector', () => {
  it('connects via OAuth2 and identifies the account', async () => {
    const s = setup();
    const conn = await connect(s);
    expect(conn).toMatchObject({ providerId: 'microsoft', accountId: 'u1', email: 'me@contoso.com' });
  });

  it('lists mail messages', async () => {
    const s = setup();
    await connect(s);
    let url = '';
    s.env.action = (c) => {
      url = c.url;
      return { status: 200, json: { value: [{ id: 'm1', subject: 'Hi', from: { emailAddress: { address: 'a@b.com' } }, receivedDateTime: 't', bodyPreview: 'p' }] } };
    };
    const out = await s.runtime.runAction('outlook_mail.list_messages', { top: 10 });
    expect(out.ok).toBe(true);
    expect((out as { result: { messages: Array<{ id: string; from: string }> } }).result.messages[0]).toMatchObject({ id: 'm1', from: 'a@b.com' });
    expect(url).toContain('/me/messages');
    expect(url).toContain('%24top=10'); // $top encoded
  });

  it('sends mail (mutating, allowed) with the right recipients payload', async () => {
    const s = setup();
    await connect(s);
    let body: string | undefined;
    s.env.action = (c) => {
      body = c.body;
      return { status: 202, json: {} };
    };
    const out = await s.runtime.runAction('outlook_mail.send_mail', { to: ['x@y.com'], subject: 'Hi', content: 'body' });
    expect(out.ok).toBe(true);
    expect((out as { result: { sent: boolean } }).result.sent).toBe(true);
    expect(body).toContain('x@y.com');
    expect(body).toContain('toRecipients');
  });

  it('creates a calendar event; a Calendars.ReadWrite grant satisfies the read action', async () => {
    const s = setup();
    await connect(s);
    s.env.action = () => ({ status: 200, json: { id: 'e1', subject: 'Sync', start: { dateTime: '2026-06-20T15:00:00' }, end: { dateTime: '2026-06-20T15:30:00' } } });
    const created = await s.runtime.runAction('outlook_calendar.create_event', {
      subject: 'Sync',
      start: '2026-06-20T15:00:00',
      end: '2026-06-20T15:30:00',
    });
    expect(created.ok).toBe(true);
    // list_events needs Calendars.Read; the connection only holds Calendars.ReadWrite → must still pass.
    s.env.action = () => ({ status: 200, json: { value: [{ id: 'e1', subject: 'Sync' }] } });
    const listed = await s.runtime.runAction('outlook_calendar.list_events', {});
    expect(listed.ok).toBe(true);
  });
});
