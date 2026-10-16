import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { pairDevice, revokeApiKey } from '@/lib/db/queries';
import { resetHomeIdentityCache } from '@/lib/home/identity';

const service = vi.hoisted(() => ({invoke: vi.fn(), cancel: vi.fn()}));
vi.mock('./service', () => ({
  callConnectedView: service.invoke,
  cancelConnectedInvocation: service.cancel,
  connectedAppsCatalog: vi.fn(), connectedViewStatus: vi.fn(), decideConnectedApproval: vi.fn(),
  launchConnectedView: vi.fn(), prepareConnectedLaunch: vi.fn(), openConnectedView: vi.fn(), updateConnectedContext: vi.fn(),
}));
// Import the real router factory. Reserved procedure names must fail this test
// at startup, before a production route tries to collect page data.
import { connectedAppsRouter } from './router';

let home: TestHome;
beforeEach(async () => {
  home = await createTestHome({prefix: 'ri-mcp-router-'});
  resetHomeIdentityCache(); service.invoke.mockReset(); service.cancel.mockReset();
});
afterEach(async () => {resetHomeIdentityCache(); await home.cleanup();});

const context = (apiKeyId: string, scope: 'viewer' | 'session' = 'viewer') => ({
  request: new Request('http://localhost/api/trpc/connectedApps.invoke'),
  key: {apiKeyId, scope, location: 'home' as const, workerDeviceId: null, sessionChatId: null},
});
const input = () => ({viewId: randomUUID(), invocationId: randomUUID(), name: 'calculate', args: {amount: 2}});

it('boots the real router and permits only a signed-in viewer to invoke a view', async () => {
  const {key} = pairDevice({name: 'Fixture viewer', kind: 'phone'}), args = input();
  service.invoke.mockResolvedValue({kind: 'result', result: {content: []}});
  expect(await connectedAppsRouter.createCaller(context(key.id)).invoke(args)).toMatchObject({kind: 'result'});
  expect(service.invoke).toHaveBeenCalledWith(args.viewId, key.id, args.name, args.args, args.invocationId);
  await expect(connectedAppsRouter.createCaller(context(key.id, 'session')).invoke(args)).rejects.toMatchObject({code: 'FORBIDDEN'});
  expect(service.invoke).toHaveBeenCalledTimes(1);
});

it('withholds a result if the viewing key is revoked during the operation', async () => {
  const {key} = pairDevice({name: 'Fixture viewer', kind: 'phone'});
  service.invoke.mockImplementation(async () => {revokeApiKey(key.id); return {kind: 'result', result: {content: [], _meta: {private: true}}};});
  await expect(connectedAppsRouter.createCaller(context(key.id)).invoke(input())).rejects.toMatchObject({code: 'UNAUTHORIZED'});
  await expect(connectedAppsRouter.createCaller(context(key.id)).invoke(input())).rejects.toMatchObject({code: 'UNAUTHORIZED'});
  expect(service.invoke).toHaveBeenCalledTimes(1);
});

it('binds cancellation to the signed-in viewer rather than a caller-supplied identity', async () => {
  const {key} = pairDevice({name: 'Fixture viewer', kind: 'phone'}), {viewId, invocationId} = input();
  await connectedAppsRouter.createCaller(context(key.id)).cancel({viewId, invocationId});
  expect(service.cancel).toHaveBeenCalledWith(viewId, key.id, invocationId);
  await expect(connectedAppsRouter.createCaller(context(key.id, 'session')).cancel({viewId, invocationId})).rejects.toMatchObject({code: 'FORBIDDEN'});
  expect(service.cancel).toHaveBeenCalledTimes(1);
});
