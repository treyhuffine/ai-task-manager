import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterEach, expect, it, vi} from 'vitest';
import type {InstalledArtifact} from '@ri/app-kit/runtime';
import type {ValidatedArtifact} from '@ri/app-kit/build';
import {LocalAppsService} from './service';
import type {AppGrant, AppInstance} from './state';

const runAction = vi.fn();
vi.mock('@/lib/service/maintenance', () => ({beginActivity: () => () => {}}));
vi.mock('@/lib/integrations/runtime', () => ({
  getIntegrationOwnerId: () => 'owner',
  getIntegrationRuntime: async () => ({
    runAction,
    getToolkits: () => [
      {id: 'gmail', providerId: 'google', displayName: 'Gmail', actions: [{id: 'gmail.get_profile', scopes: ['gmail.readonly']}, {id: 'gmail.read_message', scopes: ['gmail.readonly']}]},
      {id: 'google_calendar', providerId: 'google', displayName: 'Google Calendar', actions: [{id: 'google_calendar.sync_events', scopes: ['calendar.events.readonly']}]},
    ],
    getProviders: () => [{id: 'google', scopeSatisfies: (granted: string[], required: string) => required === 'calendar.events.readonly' && granted.includes('calendar.events')}],
    listConnections: async () => [
      {id: 'conn-personal', providerId: 'google', accountId: 'p', email: 'owner@example.test', status: 'active', scopes: ['gmail.readonly', 'calendar.events']},
      {id: 'conn-work', providerId: 'google', accountId: 'w', email: 'owner@work.example', status: 'active', scopes: ['gmail.readonly']},
      {id: 'conn-other', providerId: 'slack', accountId: 's', status: 'active', scopes: []},
    ],
  }),
}));

let root: string;
let service: LocalAppsService;
const stamp = '2026-10-15T12:00:00.000Z';
const digest = 'a'.repeat(64);
afterEach(async () => {await service?.dispose();if(root)await fs.rm(root,{recursive:true,force:true});delete process.env.RI_ROOT;delete process.env.RI_LOCAL_APPS;vi.restoreAllMocks();runAction.mockReset();});

function instance(): AppInstance {
  const id = randomUUID();
  return {id, createdAt:stamp, updatedAt:stamp, slug:'people', packageId:'ri-people', version:'0.1.0', digest, enabled:true, archived:false, customized:false, changeRevision:0, provenance:{kind:'starter',packageId:'ri-people',version:'0.1.0',sourceDigest:'b'.repeat(64)}, activation:{phase:'active',previousDigest:null,nextDigest:digest,snapshotId:null,replacementId:randomUUID()}};
}
function artifact(): ValidatedArtifact {
  return {
    digest, packageDir: '/nonexistent', files: [], sourceDigest: 'b'.repeat(64), contractDigest: 'c'.repeat(64),
    manifest: {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'ri-people', version: '0.1.0', description: 'People',
      extensions: {'com.ri': {
        formatVersion: 1, displayName: 'People', hostApi: 1, suggestedSlug: 'people',
        runtime: {kind: 'node', protocol: 'ri-ipc-v1', entry: 'dist/server.mjs', start: 'on-demand', executionProfile: 'trusted-native', access: 'ri-access-v1'},
        build: {adapter: 'ri-esbuild-v1', lockfile: 'pnpm-lock.yaml', executionProfile: 'trusted-native'},
        ui: {resources: [{uri: 'ui://ri-people/main.html', file: 'dist/ui.html'}], entrypoints: ['global', 'thread'], resolveAction: 'open_view', contextAction: 'describe_view_context', access: {path: '/access', action: 'create_scope'}},
        contract: 'contract.json',
        requests: {integrations: [{binding: 'mail', toolkit: 'gmail', actions: ['gmail.get_profile', 'gmail.read_message']}, {binding: 'calendar', toolkit: 'google_calendar', actions: ['google_calendar.sync_events']}], riActions: ['create_task', 'ai_text']},
        source: {kind: 'starter'},
      }},
    },
    contract: {formatVersion: 1, packageId: 'ri-people', version: '0.1.0', entities: [], contexts: {}, workflows: [], actions: [
      {name: 'open_view', description: 'Open', inputSchema: {}, outputSchema: {}, audience: ['user', 'agent'], effect: 'read', timeoutMs: 30000, retry: 'read_safe', errors: [], examples: [{input: {}, output: {}}], visibility: 'both'},
      {name: 'list_people', description: 'List', inputSchema: {}, outputSchema: {}, audience: ['user', 'agent'], effect: 'read', timeoutMs: 30000, retry: 'read_safe', errors: [], examples: [{input: {}, output: {}}], visibility: 'both'},
      {name: 'create_scope', description: 'Scope', inputSchema: {}, outputSchema: {}, audience: ['user'], effect: 'app_write', timeoutMs: 30000, retry: 'idempotent', errors: [], examples: [{input: {}, output: {}}], visibility: 'app'},
      {name: 'run_background_step', description: 'Step', inputSchema: {}, outputSchema: {}, audience: ['schedule'], effect: 'app_write', timeoutMs: 40000, retry: 'idempotent', errors: [], examples: [{input: {}, output: {}}], visibility: 'both'},
    ]},
  } as unknown as ValidatedArtifact;
}
function grant(app: AppInstance, principal: AppGrant['principal'], extra: Partial<AppGrant> = {}): AppGrant {
  return {id: randomUUID(), createdAt: stamp, updatedAt: stamp, instanceId: app.id, principal, actions: ['open_view', 'list_people'], riActions: [], connections: [], serviceScopeRef: null, revision: 1, revokedAt: null, ...extra};
}
async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-included-access-'));
  process.env.RI_ROOT = root;
  process.env.RI_LOCAL_APPS = '1';
  service = new LocalAppsService(id => id.startsWith('chat-') ? {status: 'active', workspaceId: null} : null);
  await service.store.initialize();
  const app = instance();
  const validated = artifact();
  vi.spyOn(service, 'artifact').mockResolvedValue(validated);
  vi.spyOn(service.engine, 'stop').mockResolvedValue();
  const installed = {...validated, instanceId: app.id, dataDir: root, cacheDir: root, logsDir: root} as InstalledArtifact;
  return {app, installed};
}

it('builds the access record from the caller grant, never from input, and marks automatic accounts', async () => {
  const {app, installed} = await setup();
  const owner = grant(app, {kind: 'owner-ui', id: 'owner'}, {connections: [{binding: 'mail', connectionId: 'conn-personal', actions: ['gmail.read_message']}, {binding: 'mail', connectionId: 'conn-work', actions: ['gmail.read_message']}]});
  const jobId = randomUUID();
  const job = grant(app, {kind: 'job', id: jobId}, {actions: ['run_background_step'], connections: [{binding: 'mail', connectionId: 'conn-personal', actions: ['gmail.read_message']}]});
  const chat = grant(app, {kind: 'chat', id: 'chat-1'}, {serviceScopeRef: 'scope-ref-1'});
  await service.store.edit(undefined, state => {
    state.instances.push(app); state.grants.push(owner, job, chat);
    state.schedules.push({id: jobId, createdAt: stamp, updatedAt: stamp, instanceId: app.id, action: 'run_background_step', input: {}, cron: '*/5 * * * *', timezone: 'UTC', activeHours: null, enabled: true, nextRunAt: stamp, grantId: job.id, runningInvocationId: null});
  });
  const context = (principal: AppGrant['principal'], grantRevision = 1) => ({id: randomUUID(), principal, audience: 'agent' as const, grantRevision, deadline: Date.now() + 30000, packageDigest: digest});
  expect(await service.invocationAccess(installed, context({kind: 'owner-ui', id: 'owner'}))).toEqual({protocol: 'ri-access-v1', actorId: 'owner-ui:owner', scopeRef: null, accounts: [
    {account: 'conn-personal', binding: 'mail', actions: ['gmail.read_message'], automatic: true},
    {account: 'conn-work', binding: 'mail', actions: ['gmail.read_message'], automatic: false},
  ]});
  expect(await service.invocationAccess(installed, context({kind: 'chat', id: 'chat-1'}))).toMatchObject({actorId: 'chat:chat-1', scopeRef: 'scope-ref-1', accounts: []});
  expect((await service.invocationAccess(installed, context({kind: 'job', id: jobId}))).accounts.map(item => item.account)).toEqual(['conn-personal']);
  expect(await service.invocationAccess(installed, context({kind: 'fixture', id: app.id}))).toEqual({protocol: 'ri-access-v1', actorId: `fixture:${app.id}`, scopeRef: null, accounts: []});
  await expect(service.invocationAccess(installed, context({kind: 'chat', id: 'chat-1'}, 7))).rejects.toThrow(/no longer allowed/);
  await expect(service.invocationAccess(installed, context({kind: 'chat', id: 'chat-unknown'}))).rejects.toThrow(/no grant/);
  // A connection removed from Ri disappears from the record while the grant still names it.
  await service.store.edit(undefined, state => {state.grants.find(item => item.id === owner.id)!.connections.push({binding: 'mail', connectionId: 'conn-deleted', actions: ['gmail.read_message']});});
  expect((await service.invocationAccess(installed, context({kind: 'owner-ui', id: 'owner'}))).accounts.map(item => item.account)).toEqual(['conn-personal', 'conn-work']);
});

it('routes a capability to the named granted account and refuses an ambiguous or ungranted one', async () => {
  const {app, installed} = await setup();
  const owner = grant(app, {kind: 'owner-ui', id: 'owner'}, {connections: [{binding: 'mail', connectionId: 'conn-personal', actions: ['gmail.get_profile']}, {binding: 'mail', connectionId: 'conn-work', actions: ['gmail.get_profile']}]});
  await service.store.edit(undefined, state => {state.instances.push(app); state.grants.push(owner);});
  runAction.mockImplementation(async (_name: string, _input: unknown, options: {connectionId: string}) => ({ok: true, result: {emailAddress: options.connectionId}}));
  const context = {id: randomUUID(), principal: {kind: 'owner-ui' as const, id: 'owner'}, audience: 'user' as const, grantRevision: 1, deadline: Date.now() + 30000, packageDigest: digest};
  const signal = new AbortController().signal;
  expect(await service.dispatchCapability(installed, context, {callId: randomUUID(), name: 'gmail.get_profile', binding: 'mail', account: 'conn-work', input: {}}, signal)).toEqual({emailAddress: 'conn-work'});
  expect(runAction.mock.calls[0][2]).toMatchObject({connectionId: 'conn-work', allowedConnectionIds: ['conn-work']});
  await expect(service.dispatchCapability(installed, context, {callId: randomUUID(), name: 'gmail.get_profile', binding: 'mail', input: {}}, signal)).rejects.toMatchObject({code: 'invalid_input'});
  await expect(service.dispatchCapability(installed, context, {callId: randomUUID(), name: 'gmail.get_profile', binding: 'mail', account: 'conn-other', input: {}}, signal)).rejects.toMatchObject({code: 'forbidden'});
  runAction.mockResolvedValueOnce({ok: false, reason: 'needs_consent'});
  await expect(service.dispatchCapability(installed, context, {callId: randomUUID(), name: 'gmail.get_profile', binding: 'mail', account: 'conn-work', input: {}}, signal)).rejects.toMatchObject({code: 'revoked'});
  runAction.mockResolvedValueOnce({ok: false, reason: 'error', code: 'connection_not_found', message: 'gone'});
  await expect(service.dispatchCapability(installed, context, {callId: randomUUID(), name: 'gmail.get_profile', binding: 'mail', account: 'conn-work', input: {}}, signal)).rejects.toMatchObject({code: 'revoked', message: expect.stringMatching(/no longer connected/)});
  runAction.mockResolvedValueOnce({ok: false, reason: 'error', code: 'provider_rate_limited', message: 'slow down'});
  await expect(service.dispatchCapability(installed, context, {callId: randomUUID(), name: 'gmail.get_profile', binding: 'mail', account: 'conn-work', input: {}}, signal)).rejects.toMatchObject({code: 'busy'});
});

it('requires a chosen data scope before a chat may use a scoped app, and rejects duplicate accounts', async () => {
  const {app} = await setup();
  await service.store.edit(undefined, state => {state.instances.push(app); state.grants.push(grant(app, {kind: 'owner-ui', id: 'owner'}));});
  const revision = () => service.store.read().revision;
  await expect(service.saveGrant({instanceId: app.id, principal: {kind: 'chat', id: 'chat-1'}, actions: ['list_people'], riActions: [], connections: [], serviceScopeRef: null}, revision())).rejects.toThrow(/Choose which app records/);
  await expect(service.saveGrant({instanceId: app.id, principal: {kind: 'chat', id: 'chat-1'}, actions: ['list_people'], riActions: [], connections: [], serviceScopeRef: 'scope-1'}, revision())).resolves.toMatchObject({serviceScopeRef: 'scope-1'});
  await expect(service.saveGrant({instanceId: app.id, principal: {kind: 'owner-ui', id: 'owner'}, actions: ['open_view'], riActions: [], connections: [
    {binding: 'mail', connectionId: 'conn-work', actions: ['gmail.get_profile']}, {binding: 'mail', connectionId: 'conn-work', actions: ['gmail.read_message']},
  ], serviceScopeRef: null}, revision())).rejects.toThrow(/appears twice/);
});

it('saves Sources as owner accounts plus one five-minute background schedule with only the automatic accounts', async () => {
  const {app} = await setup();
  await service.store.edit(undefined, state => {state.instances.push(app); state.grants.push(grant(app, {kind: 'owner-ui', id: 'owner'}));});
  const before = await service.sourcesState(app.id);
  expect(before.accounts.map(account => [account.id, account.bindings.map(binding => [binding.binding, binding.granted, binding.needsConsent])])).toEqual([
    ['conn-personal', [['mail', false, false], ['calendar', false, false]]],
    ['conn-work', [['mail', false, false], ['calendar', false, true]]],
  ]);
  await expect(service.configureSources(app.id, {accounts: [{binding: 'mail', connectionId: 'conn-work', granted: false, automatic: true}], riActions: [], backgroundRiActions: [], timezone: 'UTC'}, before.revision)).rejects.toThrow(/Grant an account/);
  const saved = await service.configureSources(app.id, {
    accounts: [{binding: 'mail', connectionId: 'conn-personal', granted: true, automatic: true}, {binding: 'mail', connectionId: 'conn-work', granted: true, automatic: false}, {binding: 'calendar', connectionId: 'conn-personal', granted: true, automatic: true}],
    riActions: ['create_task', 'ai_text'], backgroundRiActions: ['ai_text'], timezone: 'America/Denver',
  }, before.revision);
  expect(saved.background).toMatchObject({supported: true, enabled: true});
  expect(saved.riActions).toEqual([{name: 'create_task', owner: true, background: false}, {name: 'ai_text', owner: true, background: true}]);
  expect(saved.accounts.find(account => account.id === 'conn-work')!.bindings.find(binding => binding.binding === 'mail')).toMatchObject({granted: true, automatic: false});
  const state = service.store.read();
  const schedule = state.schedules.find(item => item.instanceId === app.id)!;
  expect(schedule).toMatchObject({action: 'run_background_step', cron: '*/5 * * * *', timezone: 'America/Denver', enabled: true});
  const job = state.grants.find(item => item.id === schedule.grantId)!;
  expect(job.principal).toEqual({kind: 'job', id: schedule.id});
  expect(job.actions).toEqual(['run_background_step']);
  expect(job.connections.map(item => [item.binding, item.connectionId])).toEqual([['mail', 'conn-personal'], ['calendar', 'conn-personal']]);
  const owner = state.grants.findLast(item => item.instanceId === app.id && item.principal.kind === 'owner-ui' && !item.revokedAt)!;
  expect(owner.connections).toHaveLength(3);
  expect(owner.actions).toEqual(['open_view', 'list_people']);
  // Turning every automatic account off keeps the schedule record but disables it.
  const off = await service.configureSources(app.id, {accounts: [{binding: 'mail', connectionId: 'conn-personal', granted: true, automatic: false}], riActions: [], backgroundRiActions: [], timezone: 'UTC'}, service.store.read().revision);
  expect(off.background.enabled).toBe(false);
  expect(service.store.read().schedules.filter(item => item.instanceId === app.id)).toHaveLength(1);
  await expect(service.configureSources(app.id, {accounts: [], riActions: [], backgroundRiActions: [], timezone: 'UTC'}, 1)).rejects.toThrow(/changed/);
});
