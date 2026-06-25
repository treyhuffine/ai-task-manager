/**
 * Resend connector (API key / Bearer). Connects via connectDirect, sends an email, and proves the
 * healthCheck-backed testConnection probe.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { registerResend } from '../providers/resend';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';

function setup() {
  const calls: Array<{ url: string; method: string; auth?: string; body?: string }> = [];
  const http = fakeHttp(async (c) => {
    calls.push({ url: c.url, method: c.method, auth: c.headers.authorization, body: c.body });
    if (c.url.endsWith('/emails') && c.method === 'POST') return { json: { id: 'e_1' } };
    if (c.url.includes('/emails/e_1')) return { json: { id: 'e_1', subject: 'Hi', last_event: 'delivered' } };
    if (c.url.endsWith('/domains')) return { json: { data: [] } };
    return { json: {} };
  });
  const registry = createRegistry();
  registerResend(registry);
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

describe('resend connector', () => {
  it('connects with an API key and sends an email (Bearer auth)', async () => {
    const s = setup();
    const conn = await s.runtime.connectDirect('resend', { credential: { type: 'api_key', apiKey: 're_KEY' } });
    expect(conn.providerId).toBe('resend');

    const out = await s.runtime.runAction('resend.send_email', { from: 'Acme <a@acme.com>', to: 'b@x.com', subject: 'Hi', text: 'yo' });
    expect(out.ok).toBe(true);
    expect((out as { result: { id: string } }).result.id).toBe('e_1');

    const post = s.calls.find((c) => c.url.endsWith('/emails') && c.method === 'POST');
    expect(post?.auth).toBe('Bearer re_KEY');
    expect(post?.body).toContain('"subject":"Hi"'); // JSON body
  });

  it('testConnection probes /domains → ok + verified', async () => {
    const s = setup();
    const conn = await s.runtime.connectDirect('resend', { credential: { type: 'api_key', apiKey: 're_KEY' } });
    expect(await s.runtime.testConnection(conn.id)).toMatchObject({ ok: true, status: 'active', verified: true });
    expect(s.calls.some((c) => c.url.endsWith('/domains'))).toBe(true);
  });
});
