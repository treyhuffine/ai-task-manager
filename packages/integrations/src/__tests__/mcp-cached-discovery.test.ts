import { describe, expect, it, vi } from 'vitest';
import { createIntegrationRuntime, createRegistry, IntegrationError, staticAuthConfigs } from '../index';
import { ingestMcpServer, type IngestMcpOptions } from '../mcp';
import { inMemoryStore, plaintextSecretBox } from '../testing';

async function setup() {
  const store = inMemoryStore();
  const secretBox = plaintextSecretBox();
  const client = {
    listTools: async () => ({ tools: [{ name: 'read', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] }),
    callTool: vi.fn(async () => { throw new IntegrationError('provider_unavailable', 'Discovery will retry shortly. No request was sent.'); }),
  };
  const options: IngestMcpOptions = { name: 'official', client, ownerId: 'local',
    connectionId: 'saved-account', sessionToken: 'real-transport-token', trustToolAnnotations: true,
    identity: { providerId: 'official', displayName: 'Official', accountId: 'account-1' } };
  await ingestMcpServer(createRegistry(), store, secretBox, options);
  return { store, secretBox, client, options };
}

describe('cached MCP discovery', () => {
  it.each(['active', 'needs_reauth'] as const)('preserves the complete saved connection and credential when status is %s', async status => {
    const s = await setup();
    await s.store.setStatus('saved-account', status);
    const before = await s.store.get('saved-account');
    const save = vi.spyOn(s.store, 'save');
    const registry = createRegistry();
    await ingestMcpServer(registry, s.store, s.secretBox, { ...s.options, preserveConnection: true, sessionToken: 'must-not-replace-token' });
    expect(save).not.toHaveBeenCalled();
    expect(await s.store.get('saved-account')).toEqual(before);
    const runtime = createIntegrationRuntime({ registry, store: s.store, authRequests: s.store, secretBox: s.secretBox,
      authConfigs: staticAuthConfigs([]), approval: { check: async () => 'allow' }, authorizationRequired: () => 'https://app.example/connect' });
    const outcome = await runtime.runAction('official.read', {});
    expect(outcome).toMatchObject(status === 'active' ? { code: 'provider_unavailable' } : { reason: 'auth_required' });
    if (status === 'active') expect(outcome).not.toHaveProperty('indeterminate');
    expect(s.client.callTool).toHaveBeenCalledTimes(status === 'active' ? 1 : 0);
  });

  it('does not create a connection or change account identity from cached definitions', async () => {
    const s = await setup();
    await expect(ingestMcpServer(createRegistry(), s.store, s.secretBox, {
      ...s.options, connectionId: 'missing-account', preserveConnection: true,
    })).rejects.toMatchObject({ code: 'connection_not_found' });
    await expect(ingestMcpServer(createRegistry(), s.store, s.secretBox, {
      ...s.options, identity: { ...s.options.identity!, accountId: 'different-account' }, preserveConnection: true,
    })).rejects.toMatchObject({ code: 'connection_not_found' });
    expect(await s.store.get('missing-account')).toBeNull();
  });
});
