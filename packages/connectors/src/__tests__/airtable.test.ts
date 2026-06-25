/**
 * Airtable connector — PAT (Bearer) provider connected via connectDirect, with identify().
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerAirtable } from '../providers/airtable';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';

function setup() {
  const calls: FakeHttpCall[] = [];
  const http = fakeHttp(async (call) => {
    calls.push(call);
    if (call.url.endsWith('/meta/whoami')) return { json: { id: 'usr123', email: 'a@b.com' } };
    if (call.url.endsWith('/meta/bases')) return { json: { bases: [{ id: 'app1', name: 'CRM', permissionLevel: 'create' }] } };
    if (call.url.includes('/app1/Tasks') && call.method === 'GET') {
      return { json: { records: [{ id: 'rec1', fields: { Name: 'Do it' }, createdTime: 'now' }] } };
    }
    if (call.url.includes('/app1/Tasks') && call.method === 'POST') return { json: { id: 'rec2', fields: { Name: 'New' } } };
    return { json: {} };
  });
  const registry = createRegistry();
  registerAirtable(registry);
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

describe('airtable', () => {
  it('connects via PAT, identifies the account, and lists records', async () => {
    const s = setup();
    const conn = await s.runtime.connectDirect('airtable', { credential: { type: 'api_key', apiKey: 'patXYZ' } });
    expect(conn.accountId).toBe('usr123');
    expect(conn.email).toBe('a@b.com');

    const bases = await s.runtime.runAction('airtable.list_bases', {});
    expect((bases as { result: { bases: Array<{ name: string }> } }).result.bases[0]?.name).toBe('CRM');

    const recs = await s.runtime.runAction('airtable.list_records', { baseId: 'app1', tableIdOrName: 'Tasks' });
    expect((recs as { result: { records: Array<{ id: string }> } }).result.records[0]).toMatchObject({ id: 'rec1' });
    const listCall = s.calls.find((c) => c.url.includes('/app1/Tasks') && c.method === 'GET');
    expect(listCall?.headers.authorization).toBe('Bearer patXYZ');
  });

  it('creates a record (mutating, allowed)', async () => {
    const s = setup();
    await s.runtime.connectDirect('airtable', { credential: { type: 'api_key', apiKey: 'p' } });
    const out = await s.runtime.runAction('airtable.create_record', { baseId: 'app1', tableIdOrName: 'Tasks', fields: { Name: 'New' } });
    expect(out.ok).toBe(true);
    expect((out as { result: { id: string } }).result.id).toBe('rec2');
  });
});
