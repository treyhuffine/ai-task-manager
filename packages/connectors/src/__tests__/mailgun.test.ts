/**
 * Mailgun connector (custom Basic `api:<key>`, per-domain URL, form-encoded body). Connects via
 * connectDirect, sends a message, and proves the healthCheck-backed testConnection probe.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { registerMailgun } from '../providers/mailgun';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';

function setup() {
  const calls: Array<{ url: string; method: string; auth?: string; contentType?: string; body?: string }> = [];
  const http = fakeHttp(async (c) => {
    calls.push({ url: c.url, method: c.method, auth: c.headers.authorization, contentType: c.headers['content-type'], body: c.body });
    if (c.url.includes('/messages') && c.method === 'POST') return { json: { id: '<msg@mg>', message: 'Queued. Thank you.' } };
    if (c.url.includes('/v4/domains')) return { json: { items: [] } };
    return { json: {} };
  });
  const registry = createRegistry();
  registerMailgun(registry);
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime, calls };
}

describe('mailgun connector', () => {
  it('sends a message via Basic auth, the per-domain URL, and a form-encoded body', async () => {
    const s = setup();
    await s.runtime.connectDirect('mailgun', { credential: { type: 'custom', values: { api_key: 'key-123' } } });

    const out = await s.runtime.runAction('mailgun.send_message', {
      domain: 'mg.acme.com',
      from: 'Acme <postmaster@mg.acme.com>',
      to: ['b@x.com', 'c@x.com'],
      subject: 'Hi',
      text: 'yo',
    });
    expect(out.ok).toBe(true);
    expect((out as { result: { message: string } }).result.message).toContain('Queued');

    const post = s.calls.find((c) => c.url.includes('/messages'));
    expect(post?.url).toBe('https://api.mailgun.net/v3/mg.acme.com/messages');
    expect(post?.auth).toBe(`Basic ${Buffer.from('api:key-123').toString('base64')}`);
    expect(post?.contentType).toBe('application/x-www-form-urlencoded');
    expect(post?.body).toContain('subject=Hi');
    expect(post?.body).toContain('to=b%40x.com%2Cc%40x.com'); // array joined comma-separated
  });

  it('testConnection probes /v4/domains → ok + verified', async () => {
    const s = setup();
    const conn = await s.runtime.connectDirect('mailgun', { credential: { type: 'custom', values: { api_key: 'key-123' } } });
    expect(await s.runtime.testConnection(conn.id)).toMatchObject({ ok: true, status: 'active', verified: true });
    expect(s.calls.some((c) => c.url.includes('/v4/domains'))).toBe(true);
  });
});
