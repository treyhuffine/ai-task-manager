import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileLock } from '@connectors/engine';
import { aesGcmSecretBox, generateSecretKey } from '@connectors/engine/crypto';
import { mcpServerStore, type McpServerStore } from '@/lib/connectors/mcp-servers';
import { PATCH } from './[id]/route';

const mocks = vi.hoisted(() => ({ store: undefined as McpServerStore | undefined, invalidate: vi.fn(), connections: vi.fn() }));
vi.mock('@/lib/connectors/runtime', () => ({
  getMcpServerStore: () => mocks.store!, getConnectorOwnerId: () => 'local',
  getConnectorConnectionStore: mocks.connections, invalidateConnectorRuntime: mocks.invalidate,
}));
vi.mock('@/lib/connectors/mcp-authorization', () => ({ beginMcpAuthorization: vi.fn() }));
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-review-route-'));
  mocks.invalidate.mockReset();
  mocks.connections.mockReset();
  mocks.store = mcpServerStore({ dir, secretBox: aesGcmSecretBox({ key: generateSecretKey() }), lock: fileLock({ dir: path.join(dir, 'locks') }) });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const patch = (id: string, body: unknown) => PATCH(new NextRequest(`https://app.example/api/connectors/mcp-servers/${id}`, {
  method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
}), { params: Promise.resolve({ id }) });
async function changed() {
  const store = mocks.store!;
  const entry = await store.create({ slug: 'fixture', displayName: 'Fixture', url: 'https://mcp.example/mcp', auth: { kind: 'oauth' } });
  await store.setOAuthState(entry.id, { tokens: { access_token: 'fixture-access', token_type: 'Bearer' } });
  await store.recordCapabilities(entry.id, [{ name: 'read', annotations: { readOnlyHint: true } }]);
  const current = (await store.recordCapabilities(entry.id, [
    { name: 'read', annotations: { readOnlyHint: false } }, { name: 'write' },
  ]))!;
  return { store, entry: current };
}

describe('capability review API', () => {
  it('acknowledges the current revision without changing credentials, tools or transport configuration', async () => {
    const { store, entry } = await changed();
    const credentials = await store.getOAuthState(entry.id);
    const response = await patch(entry.id, { reviewedRevision: entry.capabilityRevision });
    expect(response.status).toBe(200);
    expect((await response.json()).entry).toMatchObject({ id: entry.id, capabilityRevision: entry.capabilityRevision });
    expect(store.get(entry.id)?.capabilityChanges).toBeUndefined();
    expect(store.get(entry.id)?.tools).toEqual(entry.tools);
    expect(await store.getOAuthState(entry.id)).toEqual(credentials);
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.connections).not.toHaveBeenCalled();
  });

  it('rejects a stale revision without clearing newly discovered changes', async () => {
    const { store, entry } = await changed();
    const newest = (await store.recordCapabilities(entry.id, [{ name: 'latest' }]))!;
    const response = await patch(entry.id, { reviewedRevision: entry.capabilityRevision });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: expect.stringContaining('changed again') });
    expect(store.get(entry.id)?.capabilityChanges).toEqual(newest.capabilityChanges);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it('allows repeat acknowledgment when the capability revision did not change', async () => {
    const { store, entry } = await changed();
    expect((await patch(entry.id, { reviewedRevision: entry.capabilityRevision })).status).toBe(200);
    const after = store.get(entry.id);
    expect((await patch(entry.id, { reviewedRevision: entry.capabilityRevision })).status).toBe(200);
    expect(store.get(entry.id)).toEqual({ ...after, updatedAt: expect.any(String) });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it.each([{ enabled: false }, { toolOverrides: { read: { enabled: false } } }, { secret: 'replacement-secret' }])(
    'requires capability review to be separate from connection mutations: %j', async extra => {
      const { store, entry } = await changed();
      const response = await patch(entry.id, { reviewedRevision: entry.capabilityRevision, ...extra });
      expect(response.status).toBe(400);
      expect(store.get(entry.id)).toEqual(entry);
      expect(mocks.connections).not.toHaveBeenCalled();
      expect(mocks.invalidate).not.toHaveBeenCalled();
    },
  );

  it('returns not found if the account is removed before the atomic acknowledgment', async () => {
    const { store, entry } = await changed();
    const acknowledge = store.acknowledgeCapabilities.bind(store);
    vi.spyOn(store, 'acknowledgeCapabilities').mockImplementationOnce(async (id, revision) => {
      await store.remove(id);
      return acknowledge(id, revision);
    });
    const response = await patch(entry.id, { reviewedRevision: entry.capabilityRevision });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(store.get(entry.id)).toBeNull();
  });
});
