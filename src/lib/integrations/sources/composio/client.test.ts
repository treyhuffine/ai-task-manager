import { describe, expect, it } from 'vitest';
import { ComposioApiError, createComposioClient, sessionCreateBody } from './client';
import { createFakeComposio, seedCatalogTools } from './fake-composio';

const KEY = 'ak_fake_project_key';

async function rejection(promise: Promise<unknown>): Promise<ComposioApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ComposioApiError) return error;
    throw error;
  }
  throw new Error('expected a ComposioApiError');
}

function setup() {
  const fake = createFakeComposio({ apiKey: KEY });
  seedCatalogTools(fake);
  const client = createComposioClient({ apiKey: KEY, baseUrl: 'https://fake.composio/api/v3.1', fetch: fake.fetch, sleep: async () => {} });
  return { fake, client };
}

describe('Composio REST client', () => {
  it('reads the project the key reaches, dropping everything else in the response', async () => {
    const { client } = setup();
    const info = await client.projectInfo();
    expect(info).toEqual({ id: 'proj_fake', name: 'Ri dev' });
    expect(JSON.stringify(info)).not.toMatch(/whsec|ak_leak/);
  });

  it('returns null project info for a scoped key that cannot read it', async () => {
    const { fake, client } = setup();
    fake.state.sessionInfoForbidden = true;
    expect(await client.projectInfo()).toBeNull();
  });

  it('rejects a bad key without echoing it', async () => {
    const fake = createFakeComposio({ apiKey: KEY });
    const client = createComposioClient({ apiKey: 'ak_wrong_secret_value', baseUrl: 'https://fake.composio/api/v3.1', fetch: fake.fetch });
    const error = await rejection(client.projectInfo());
    expect(error).toBeInstanceOf(ComposioApiError);
    expect(error.kind).toBe('unauthorized');
    expect(error.message).not.toContain('ak_wrong_secret_value');
  });

  it('scrubs the key from vendor error text', async () => {
    const { fake, client } = setup();
    fake.state.failures.push({ method: 'GET', path: '/connected_accounts/ca_x', status: 400, body: { error: { message: `bad key ${KEY} in request` } } });
    const error = await rejection(client.getConnectedAccount('ca_x'));
    expect(error.message).toBe('bad key [redacted] in request');
  });

  it('drops token state when parsing a connected account', async () => {
    const { fake, client } = setup();
    const seeded = fake.seedAccount({ user_id: 'ri-user', toolkit: 'gmail', email: 'a@example.com' });
    const account = await client.getConnectedAccount(seeded.id);
    expect(account).toMatchObject({ id: seeded.id, userId: 'ri-user', status: 'ACTIVE', toolkitSlug: 'gmail' });
    expect(JSON.stringify(account)).not.toContain('ya29');
  });

  it('sends repeated query values comma-joined', async () => {
    const { fake, client } = setup();
    fake.seedAccount({ user_id: 'u1', toolkit: 'gmail', email: 'a@example.com' });
    fake.seedAccount({ user_id: 'u2', toolkit: 'gmail', email: 'b@example.com' });
    fake.seedAccount({ user_id: 'u3', toolkit: 'gmail', email: 'c@example.com' });
    const accounts = await client.listConnectedAccounts({ userIds: ['u1', 'u2'] });
    expect(accounts.map(a => a.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('retries a read through a transient outage and honors retry timing', async () => {
    const { fake, client } = setup();
    fake.state.failures.push({ method: 'GET', path: '/tools', status: 503 });
    fake.state.failures.push({ method: 'GET', path: '/tools', status: 429, headers: { 'retry-after': '1' } });
    const tools = await client.listTools('gmail', ['GMAIL_SEND_EMAIL']);
    expect(tools.map(t => t.slug)).toEqual(['GMAIL_SEND_EMAIL']);
  });

  it('never retries a write, and reports a server failure as possibly applied', async () => {
    const { fake, client } = setup();
    fake.state.failures.push({ method: 'POST', path: '/tool_router/session', status: 502 });
    const error = await rejection(client.createSession({ userId: 'u', toolkitSlug: 'gmail', toolSlugs: ['GMAIL_SEND_EMAIL'], connectedAccountId: 'ca' })
      );
    expect(error.maybeApplied).toBe(true);
    expect(fake.state.requests.filter(r => r.method === 'POST' && r.path === '/tool_router/session')).toHaveLength(1);
  });

  it('reports a refused write as not applied', async () => {
    const { fake, client } = setup();
    fake.state.failures.push({ method: 'POST', path: '/tool_router/session', status: 400 });
    const error = await rejection(client.createSession({ userId: 'u', toolkitSlug: 'gmail', toolSlugs: ['GMAIL_SEND_EMAIL'], connectedAccountId: 'ca' })
      );
    expect(error).toMatchObject({ kind: 'invalid', maybeApplied: false });
  });

  it('reports a dropped response after a write as possibly applied', async () => {
    const { fake, client } = setup();
    fake.state.dropAfterWrite.push({ method: 'POST', path: '/tool_router/session' });
    const error = await rejection(client.createSession({ userId: 'u', toolkitSlug: 'gmail', toolSlugs: ['GMAIL_SEND_EMAIL'], connectedAccountId: 'ca' })
      );
    expect(error).toMatchObject({ kind: 'unavailable', maybeApplied: true });
  });

  it('builds a session body with every restriction explicit', () => {
    expect(sessionCreateBody({ userId: 'u', toolkitSlug: 'gmail', toolSlugs: ['B', 'A'], connectedAccountId: 'ca_1' })).toEqual({
      user_id: 'u',
      toolkits: { enable: ['gmail'] },
      tools: { gmail: { enable: ['A', 'B'] } },
      connected_accounts: { gmail: ['ca_1'] },
      preload: { tools: ['A', 'B'] },
      multi_account: { enable: false },
      workbench: { enable: false },
      proxy_execute: { enable: false },
      manage_connections: { enable: false, enable_wait_for_connections: false, enable_connection_removal: false },
      search: { enable: false },
      execute: { enable_multi_execute: false },
      instant: false,
    });
  });
});
