import { beforeEach, expect, it, vi } from 'vitest';
import { ChatSources, type SourceMessage } from './service';
import { encodeSource, sourceMarker } from './reference';
import type { SourceAdapter, SourceDescriptor } from './types';
const one = encodeSource({ v: 1, kind: 'integration', toolkitId: 'mail', account: { accountId: 'same', authConfigId: 'work' } });
const two = encodeSource({ v: 1, kind: 'integration', toolkitId: 'mail', account: { accountId: 'same', authConfigId: 'personal' } });
const app = encodeSource({ v: 1, kind: 'app', instanceId: '01900111-1111-7111-8111-111111111111' });
let enabled: boolean, rows: SourceMessage[], sources: SourceDescriptor[], adapter: SourceAdapter, service: ChatSources;
beforeEach(() => {
  enabled = true;
  sources = [one, two].map((ref, i) => ({ sourceRef: ref, label: `Mail · ${i ? 'Personal' : 'Work'}`, service: 'Mail', accountLabel: i ? 'Personal' : 'Work', groupId: 'mail', keywords: [i ? 'Personal' : 'Work'], status: 'ready', chat: true, view: 'none' }));
  rows = [{ id: 'm1', sessionId: 'c1', role: 'user', source: 'user', content: sourceMarker(one) }, { id: 'm2', sessionId: 'c2', role: 'user', source: 'user', content: sourceMarker(two) }];
  adapter = { kind: 'integration', list: vi.fn(async () => sources), actions: vi.fn(async () => [{ id: 'read', description: 'Read mail', inputSchema: { type: 'object' } }]), call: vi.fn(async ref => ref) };
  service = new ChatSources({ enabled: () => enabled, adapters: async () => [adapter], message: id => rows.find(r => r.id === id) ?? null, context: async chatId => ({ chatId, workspaceId: null, harnessReady: true }) });
});
it('searches inert metadata and drills into accounts rather than picking the first', async () => {
  expect(await service.search('c1', '')).toEqual({ items: [{ kind: 'sourceGroup', groupId: 'mail', label: 'Mail', count: 2 }], total: 1 });
  expect((await service.search('c1', '', 'app', 'mail')).items).toHaveLength(2);
  expect((await service.search('c1', 'work')).items).toEqual([{ kind: 'source', source: sources[0] }]);
  expect(adapter.actions).not.toHaveBeenCalled(); expect(adapter.call).not.toHaveBeenCalled();
});
it('opens only on an explicit request through an installed view adapter', async () => {
  adapter.open = vi.fn(async () => {});
  await service.search('c1', ''); await service.resolve('c1', [one]);
  expect(adapter.open).not.toHaveBeenCalled();
  await service.openView('c1', one);
  expect(adapter.open).toHaveBeenCalledOnce();
  sources[0].status = 'unavailable';
  await expect(service.openView('c1', one)).rejects.toMatchObject({ code: 'unavailable' });
});
it('binds message, source and caller independently across concurrent chats and refuses forged/tool references', async () => {
  const [a, b] = await Promise.all([service.call('c1', 'm1', one, 'read', {}, 'invoke1'), service.call('c2', 'm2', two, 'read', {}, 'invoke2')]);
  expect(a).not.toEqual(b);
  await expect(service.describe('c2', 'm1', one)).rejects.toMatchObject({ code: 'forbidden' });
  await expect(service.describe('c1', 'm1', two)).rejects.toMatchObject({ code: 'forbidden' });
  await expect(service.describe(null, 'm1', one)).rejects.toMatchObject({ code: 'forbidden' });
  rows[0].source = 'tool_result';
  await expect(service.describe('c1', 'm1', one)).rejects.toMatchObject({ code: 'forbidden' });
});
it('preflights access without letting picker visibility authorize an agent', async () => {
  sources[0].status = 'needs_access';
  expect((await service.resolve('c1', [one], { privateLabels: true }))[0].label).toContain('Work');
  expect((await service.resolve('c1', [one]))[0].label).toBe('Unavailable app');
  await expect(service.preflight('c1', sourceMarker(one))).rejects.toMatchObject({ code: 'unavailable', sources: [sources[0]] });
  expect(adapter.call).not.toHaveBeenCalled();
});
it('rechecks revocation before releasing results and rejects account overrides', async () => {
  await expect(service.call('c1', 'm1', one, 'read', { account: 'Personal' }, 'i')).rejects.toMatchObject({ code: 'forbidden' });
  expect(adapter.call).not.toHaveBeenCalled();
  adapter.call = vi.fn(async () => { sources[0].status = 'unavailable'; return { secret: 'never delivered' }; });
  await expect(service.call('c1', 'm1', one, 'read', {}, 'i')).rejects.toMatchObject({ code: 'unavailable' });
});
it('retains readable historical references with flags off and a missing local adapter', async () => {
  expect((await service.resolve('c1', [app]))[0].status).toBe('unavailable');
  expect((await service.resolve('c1', [one]))[0].status).toBe('ready');
  enabled = false;
  expect(await service.search('c1', '')).toEqual({ items: [], total: 0 });
  expect((await service.resolve('c1', [one, app])).every(s => s.status === 'unavailable')).toBe(true);
  await expect(service.preflight('c1', sourceMarker(one))).rejects.toMatchObject({ code: 'unavailable' });
  expect(await service.preflight('c1', 'ordinary chat')).toEqual([]);
});
it('does not execute an already cancelled request or deliver a cancelled result', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(service.call('c1', 'm1', one, 'read', {}, 'i', controller.signal)).rejects.toThrow();
  expect(adapter.call).not.toHaveBeenCalled();
  const midflight = new AbortController();
  adapter.call = vi.fn(async () => { midflight.abort(); return { secret: 'not delivered' }; });
  await expect(service.call('c1', 'm1', one, 'read', {}, 'i', midflight.signal)).rejects.toThrow();
});
it('bounds schemas and turn context without provider data or mutable last-source state', async () => {
  const text = await service.turnContext('c1', 'm1');
  expect(text).toContain('message_id'); expect(text).toContain(one); expect(text).not.toContain(two);
  adapter.actions = vi.fn(async () => Array.from({ length: 25 }, (_, i) => ({ id: `read${i}`, description: 'Read', inputSchema: {} })));
  expect((await service.describe('c1', 'm1', one)).actions).toHaveLength(20);
  expect((await service.describe('c1', 'm1', one, undefined, 20)).actions).toHaveLength(5);
  adapter.actions = vi.fn(async () => [{ id: 'huge', description: 'Read', inputSchema: { description: 'x'.repeat(65536) } }]);
  await expect(service.describe('c1', 'm1', one, 'huge')).rejects.toMatchObject({ code: 'unavailable' });
});
