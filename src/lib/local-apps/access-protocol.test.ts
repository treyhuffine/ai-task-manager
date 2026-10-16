import '@/test/fixtures/offline-local-apps';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';
import {LocalAppsService} from './service';

const runAction = vi.fn();
let connections = [{id: 'conn-a', providerId: 'google', accountId: 'a', email: 'owner@example.test', status: 'active', scopes: ['gmail.readonly']}];
vi.mock('@/lib/service/maintenance', () => ({beginActivity: () => () => {}}));
vi.mock('@/lib/integrations/runtime', () => ({
  getIntegrationOwnerId: () => 'owner',
  getIntegrationRuntime: async () => ({
    runAction,
    getToolkits: () => [{id: 'gmail', providerId: 'google', displayName: 'Gmail', actions: [{id: 'gmail.get_profile', scopes: ['gmail.readonly']}]}],
    getProviders: () => [{id: 'google'}],
    listConnections: async () => connections,
  }),
}));

let root: string, service: LocalAppsService;
afterEach(async () => {
  await service?.dispose();
  if (root) await fs.rm(root, {recursive: true, force: true});
  delete process.env.RI_LOCAL_APPS;
  delete process.env.RI_ROOT;
});

/** A real generated package whose SDK negotiates ri-access-v1 and reports what each caller receives. */
function actionsSource(packageId: string) {
  const uri = `ui://${packageId}/main.html`;
  return `import {z} from 'zod/v4';import {defineAction,type AppDefinition} from '@ri/app-kit/sdk';
export function initialize(){} export function shutdown(){}
const location=z.object({path:z.string(),query:z.record(z.string(),z.string())}).strict();
const access=z.object({access:z.unknown(),profile:z.unknown()}).strict();
const open=defineAction({name:'open_view',description:'Open the fictional view',input:location,output:z.object({resource:z.literal(${JSON.stringify(uri)}),data:z.object({actorId:z.string().nullable()}).strict(),scope:z.object({actions:z.array(z.string()),bindings:z.record(z.string(),z.string()).optional()}).strict()}).strict(),audience:['user','agent'],effect:'read',retry:'read_safe',
  examples:[{input:{path:'/',query:{}},output:{resource:${JSON.stringify(uri)},data:{actorId:null},scope:{actions:['whoami']}}}],
  handler:({path,query})=>path==='/access'?{resource:${JSON.stringify(uri)},data:{actorId:query.hostActor??null},scope:{actions:['create_scope'],bindings:{actorId:query.hostActor??''}}}:{resource:${JSON.stringify(uri)},data:{actorId:null},scope:{actions:['whoami']}}});
const whoami=defineAction({name:'whoami',description:'Report the access Ri supplied',input:z.object({account:z.string().optional()}).strict(),output:access,audience:['user','agent','schedule'],effect:'read',retry:'read_safe',examples:[{input:{},output:{access:null,profile:null}}],
  handler:async(input,ctx)=>({access:ctx.access,profile:input.account?await ctx.capability('gmail.get_profile',{},{binding:'mail',account:input.account}):null})});
const scope=defineAction({name:'create_scope',description:'Issue a fictional scope reference',input:z.object({actorId:z.string()}).strict(),output:z.object({scopeRef:z.string()}).strict(),audience:['user'],effect:'app_write',retry:'idempotent',visibility:'app',examples:[{input:{actorId:'chat:x'},output:{scopeRef:'scope-chat:x'}}],handler:input=>({scopeRef:'scope-'+input.actorId})});
const context=defineAction({name:'describe_view_context',description:'Resolve context',input:location.extend({state:z.object({}).strict()}),output:z.object({modelContent:z.string(),recordRefs:z.array(z.never()),dataRevision:z.string()}).strict(),audience:['user','agent'],effect:'read',retry:'read_safe',examples:[{input:{path:'/',query:{},state:{}},output:{modelContent:'Nothing selected',recordRefs:[],dataRevision:'0'}}],handler:()=>({modelContent:'Nothing selected',recordRefs:[],dataRevision:'0'})});
const step=defineAction({name:'run_background_step',description:'One bounded fictional step',input:z.object({}).strict(),output:access,audience:['schedule'],effect:'app_write',retry:'idempotent',timeoutMs:40000,examples:[{input:{},output:{access:null,profile:null}}],handler:(_input,ctx)=>({access:ctx.access,profile:null})});
export const definition:AppDefinition={packageId:${JSON.stringify(packageId)},version:'0.1.0',actions:[open,whoami,scope,context,step],contexts:{${JSON.stringify(uri)}:z.object({}).strict()}};
`;
}

it('negotiates per-invocation access with a real package and delivers each caller its own scope and accounts', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-access-protocol-'));
  process.env.RI_ROOT = root;
  delete process.env.RI_LOCAL_APPS;
  service = new LocalAppsService(id => id === 'chat-a' || id === 'chat-b' ? {status: 'active', workspaceId: null} : null);
  await service.initialize();
  const draft = await service.createDraft('react');
  const dir = service.draftDir(draft.id);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'plugin.json'), 'utf8'));
  const extension = manifest.extensions['com.ri'];
  extension.runtime.access = 'ri-access-v1';
  extension.ui.access = {path: '/access', action: 'create_scope'};
  extension.requests.integrations = [{binding: 'mail', toolkit: 'gmail', actions: ['gmail.get_profile']}];
  await fs.writeFile(path.join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(dir, 'src/actions.ts'), actionsSource(manifest.name));
  await service.build(draft.id).catch(async error => {
    throw new Error(error.message + '\n' + await fs.readFile(path.join(root, 'app-drafts', draft.id, 'logs/build.log'), 'utf8').catch(() => ''));
  });
  // A preview has fixture authority and no accounts.
  const preview = await service.engine.invoke({...(await service.artifact(draft.id, true)), instanceId: draft.id, dataDir: path.join(root, 'app-drafts', draft.id, 'data'), cacheDir: path.join(root, 'app-drafts', draft.id, 'cache'), logsDir: path.join(root, 'app-drafts', draft.id, 'logs')}, 'whoami', {}, {kind: 'fixture', id: draft.id, fixtureAudience: 'user'}, 0) as {access: {actorId: string; accounts: unknown[]}};
  expect(preview.access).toMatchObject({actorId: `fixture:${draft.id}`, scopeRef: null, accounts: []});

  const installed = await service.activate(draft.id, service.store.read().revision);
  const owner = await service.call(installed.id, 'whoami', {}) as {access: unknown};
  expect(owner.access).toEqual({protocol: 'ri-access-v1', actorId: 'owner-ui:owner', scopeRef: null, accounts: []});

  // The owner grants an account, then reads through it by name.
  await service.configureSources(installed.id, {accounts: [{binding: 'mail', connectionId: 'conn-a', granted: true, automatic: true}], riActions: [], backgroundRiActions: [], timezone: 'UTC'}, service.store.read().revision);
  runAction.mockResolvedValue({ok: true, result: {emailAddress: 'owner@example.test', historyId: '7'}});
  const withAccount = await service.call(installed.id, 'whoami', {account: 'conn-a'}) as {access: {accounts: unknown[]}; profile: unknown};
  expect(withAccount.access.accounts).toEqual([{account: 'conn-a', binding: 'mail', actions: ['gmail.get_profile'], automatic: true}]);
  expect(withAccount.profile).toEqual({emailAddress: 'owner@example.test', historyId: '7'});
  expect(runAction.mock.calls.at(-1)![2]).toMatchObject({connectionId: 'conn-a', caller: {type: 'app'}});

  // The scheduled step sees only its job grant's accounts.
  const schedule = service.store.read().schedules.find(item => item.instanceId === installed.id)!;
  const job = await service.call(installed.id, 'run_background_step', {}, {kind: 'job', id: schedule.id}) as {access: {actorId: string; accounts: {account: string}[]}};
  await expect(service.call(installed.id, 'whoami', {}, {kind: 'job', id: schedule.id})).rejects.toThrow();
  expect(job.access.actorId).toBe(`job:${schedule.id}`);
  expect(job.access.accounts.map(item => item.account)).toEqual(['conn-a']);

  // The native access page binds the intended caller, and a chat grant needs the scope it produced.
  const accessView = await service.openView({id: installed.id, path: '/access', query: {hostActor: 'chat:chat-a'}}, 'viewer');
  const created = await service.viewCall(accessView.viewId, 'viewer', 'create_scope', {actorId: 'chat:forged'}, crypto.randomUUID()) as {scopeRef: string};
  expect(created.scopeRef).toBe('scope-chat:chat-a');
  await expect(service.saveGrant({instanceId: installed.id, principal: {kind: 'chat', id: 'chat-a'}, actions: ['whoami'], riActions: [], connections: [], serviceScopeRef: null}, service.store.read().revision)).rejects.toThrow(/Choose which app records/);
  await service.saveGrant({instanceId: installed.id, principal: {kind: 'chat', id: 'chat-a'}, actions: ['whoami'], riActions: [], connections: [], serviceScopeRef: created.scopeRef}, service.store.read().revision);
  await service.saveGrant({instanceId: installed.id, principal: {kind: 'chat', id: 'chat-b'}, actions: ['whoami'], riActions: [], connections: [], serviceScopeRef: 'scope-chat:chat-b'}, service.store.read().revision);
  expect((await service.call(installed.id, 'whoami', {}, {kind: 'chat', id: 'chat-a'}) as {access: {scopeRef: string}}).access.scopeRef).toBe('scope-chat:chat-a');
  expect((await service.call(installed.id, 'whoami', {}, {kind: 'chat', id: 'chat-b'}) as {access: {scopeRef: string}}).access.scopeRef).toBe('scope-chat:chat-b');

  // Disconnecting the account in Ri removes it from every access record at once.
  connections = [];
  await new Promise(resolve => setTimeout(resolve, 5100));
  expect((await service.call(installed.id, 'whoami', {}) as {access: {accounts: unknown[]}}).access.accounts).toEqual([]);
  expect((await service.sourcesState(installed.id)).disconnected).toBe(1);
}, 120_000);
