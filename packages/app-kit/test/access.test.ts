import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { z } from 'zod/v4';
import { ContractValidator, type InvocationAccess } from '@ri/app-kit/contract';
import { AppEngine, NativeNodeDriver, type CapabilityCall, type HostServices } from '@ri/app-kit/runtime';
import { generateContract, defineAction } from '@ri/app-kit/sdk';
import { staticFixture } from '@ri/app-kit/testing';
import { validateArtifact, prepareHtml } from '@ri/app-kit/build';

const require = createRequire(import.meta.url);
const temporary: string[] = [];
const engines: AppEngine[] = [];
/** Every removable directory comes from mkdtemp under the OS temp folder. */
function tempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(engines.splice(0).map(engine => engine.dispose()));
  for (const dir of temporary.splice(0)) {
    if (!path.resolve(dir).startsWith(fs.realpathSync(os.tmpdir())) && !path.resolve(dir).startsWith(os.tmpdir())) throw new Error(`Refusing to remove ${dir}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const whoamiOutput = z.object({ access: z.unknown(), mail: z.unknown() }).strict();
function definition() {
  return {
    packageId: 'local-access',
    version: '0.1.0',
    actions: [
      defineAction({
        name: 'whoami', description: 'Report the fictional caller access', input: z.object({ account: z.string().optional() }).strict(), output: whoamiOutput,
        audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', examples: [{ input: {}, output: { access: null, mail: null } }], handler: () => ({ access: null, mail: null }),
      }),
      defineAction({
        name: 'open_view', description: 'Open the fictional view', input: z.object({ path: z.string(), query: z.record(z.string(), z.string()) }).strict(),
        output: z.object({ resource: z.string(), data: z.object({}).strict(), scope: z.object({ actions: z.array(z.string()) }).strict() }).strict(),
        audience: ['user', 'agent'], effect: 'read', retry: 'read_safe',
        examples: [{ input: { path: '/', query: {} }, output: { resource: 'ui://local-access/main.html', data: {}, scope: { actions: [] } } }],
        handler: () => ({ resource: 'ui://local-access/main.html', data: {}, scope: { actions: [] } }),
      }),
    ],
  };
}

/** A packaged Node fixture. `confirm: false` imitates an SDK that predates the access protocol. */
async function accessFixture(confirm = true) {
  const root = tempDir('ri-app-access-');
  const directory = path.join(root, 'package');
  const artifact = staticFixture(directory, 'local-access');
  const manifest = artifact.manifest;
  manifest.extensions['com.ri'].runtime = { kind: 'node', protocol: 'ri-ipc-v1', entry: 'dist/server.mjs', start: 'on-demand', executionProfile: 'trusted-native', access: 'ri-access-v1' };
  manifest.extensions['com.ri'].ui!.resolveAction = 'open_view';
  manifest.extensions['com.ri'].requests.integrations = [{ binding: 'mail', toolkit: 'gmail', actions: ['gmail.get_profile'] }];
  fs.writeFileSync(path.join(directory, 'plugin.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, 'contract.json'), JSON.stringify(generateContract(definition())));
  const sdk = require.resolve('@ri/app-kit/sdk');
  const zod = JSON.stringify(require.resolve('zod/v4'));
  const server = confirm
    ? `import {z} from ${zod};import {serveApp,defineAction} from ${JSON.stringify(sdk)};
      const out=z.object({access:z.unknown(),mail:z.unknown()}).strict();
      serveApp({packageId:'local-access',version:'0.1.0',actions:[
        defineAction({name:'whoami',description:'Report the fictional caller access',input:z.object({account:z.string().optional()}).strict(),output:out,audience:['user','agent'],effect:'read',retry:'read_safe',examples:[{input:{},output:{access:null,mail:null}}],
          handler:async(input,ctx)=>({access:ctx.access,mail:input.account?await ctx.capability('gmail.get_profile',{},{binding:'mail',account:input.account}):null})}),
        defineAction({name:'open_view',description:'Open the fictional view',input:z.object({path:z.string(),query:z.record(z.string(),z.string())}).strict(),output:z.object({resource:z.string(),data:z.object({}).strict(),scope:z.object({actions:z.array(z.string())}).strict()}).strict(),audience:['user','agent'],effect:'read',retry:'read_safe',examples:[{input:{path:'/',query:{}},output:{resource:'ui://local-access/main.html',data:{},scope:{actions:[]}}}],handler:()=>({resource:'ui://local-access/main.html',data:{},scope:{actions:[]}})}),
      ]},{initialize(){}});`
    : `process.on('message',message=>{if(message.method==='initialize')process.send({version:1,id:message.id,result:{version:1,contractDigest:message.params.contractDigest}});});process.on('disconnect',()=>process.exit(0));`;
  fs.writeFileSync(path.join(directory, 'fixture.mjs'), server);
  await build({ entryPoints: [path.join(directory, 'fixture.mjs')], outfile: path.join(directory, 'dist/server.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'node26', banner: { js: 'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);' }, logLevel: 'silent' });
  const validated = validateArtifact(directory);
  const instanceId = randomUUID();
  return { ...validated, instanceId, dataDir: path.join(root, 'data'), cacheDir: path.join(root, 'cache'), logsDir: path.join(root, 'logs') };
}

function host(access: (principal: string) => InvocationAccess | undefined) {
  const calls: CapabilityCall[] = [];
  const services: HostServices = {
    version: 1,
    authorize() {},
    async capability(_instance, _context, call) { calls.push(call); return { emailAddress: `${call.account}@example.test` }; },
    event() {},
    invocationAccess(_instance, context) {
      const value = access(`${context.principal.kind}:${context.principal.id}`);
      if (!value) throw new Error('No access record');
      return value;
    },
  };
  return { services, calls };
}

describe('negotiated Node data access', () => {
  it('validates the opt-in manifest field and requires it beside native account selection', () => {
    const validator = new ContractValidator();
    const base = staticFixture(path.join(tempDir('ri-app-access-manifest-'), 'package'), 'local-manifest').manifest;
    const node = { kind: 'node', protocol: 'ri-ipc-v1', entry: 'dist/server.mjs', start: 'on-demand', executionProfile: 'trusted-native' };
    const ui = { ...base.extensions['com.ri'].ui, resolveAction: 'open_view' };
    const manifest = (runtime: object, extra: object = {}) => ({ ...base, extensions: { 'com.ri': { ...base.extensions['com.ri'], runtime, ui: { ...ui, ...extra } } } });
    expect(validator.manifest(manifest({ ...node, access: 'ri-access-v1' })).extensions['com.ri'].runtime.access).toBe('ri-access-v1');
    expect(() => validator.manifest(manifest({ ...node, access: 'ri-access-v9' }))).toThrow();
    expect(() => validator.manifest({ ...base, extensions: { 'com.ri': { ...base.extensions['com.ri'], runtime: { kind: 'static', access: 'ri-access-v1' } } } })).toThrow(/ri-ipc-v1/);
    expect(() => validator.manifest(manifest(node, { access: { path: '/access', action: 'create_scope' } }))).toThrow(/runtime.access/);
    expect(validator.manifest(manifest({ ...node, access: 'ri-access-v1' }, { access: { path: '/access', action: 'create_scope' } }))).toBeTruthy();
  });

  it('delivers the host-bound access record to each invocation and routes a capability to the named account', async () => {
    const instance = await accessFixture();
    const records: Record<string, InvocationAccess> = {
      'owner-ui:owner': { protocol: 'ri-access-v1', actorId: 'owner-ui:owner', scopeRef: null, accounts: [{ account: 'acct-1', binding: 'mail', actions: ['gmail.get_profile'], automatic: true }, { account: 'acct-2', binding: 'mail', actions: ['gmail.get_profile'], automatic: false }] },
      'chat:c-1': { protocol: 'ri-access-v1', actorId: 'chat:c-1', scopeRef: 'scope-1', accounts: [] },
    };
    const { services, calls } = host(principal => records[principal]);
    const engine = new AppEngine(services, new NativeNodeDriver(process.execPath)); engines.push(engine);
    const owner = await engine.invoke(instance, 'whoami', { account: 'acct-2' }, { kind: 'owner-ui', id: 'owner' }, 1) as { access: InvocationAccess; mail: unknown };
    expect(owner.access).toEqual(records['owner-ui:owner']);
    expect(owner.mail).toEqual({ emailAddress: 'acct-2@example.test' });
    expect(calls).toMatchObject([{ name: 'gmail.get_profile', binding: 'mail', account: 'acct-2' }]);
    const chat = await engine.invoke(instance, 'whoami', {}, { kind: 'chat', id: 'c-1' }, 1) as { access: InvocationAccess };
    expect(chat.access.scopeRef).toBe('scope-1');
    // A host that cannot produce an access record never runs the action.
    await expect(engine.invoke(instance, 'whoami', {}, { kind: 'chat', id: 'unknown' }, 1)).rejects.toThrow();
  });

  it('refuses to run a package whose SDK does not confirm the access protocol', async () => {
    const instance = await accessFixture(false);
    const { services } = host(() => ({ protocol: 'ri-access-v1', actorId: 'owner-ui:owner', scopeRef: null, accounts: [] }));
    const engine = new AppEngine(services, new NativeNodeDriver(process.execPath)); engines.push(engine);
    await expect(engine.invoke(instance, 'whoami', {}, { kind: 'owner-ui', id: 'owner' }, 1)).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('refuses a declared package on a host without access support', async () => {
    const instance = await accessFixture();
    const { services } = host(() => undefined);
    delete (services as Partial<HostServices>).invocationAccess;
    const engine = new AppEngine(services, new NativeNodeDriver(process.execPath)); engines.push(engine);
    await expect(engine.invoke(instance, 'whoami', {}, { kind: 'owner-ui', id: 'owner' }, 1)).rejects.toMatchObject({ code: 'unsupported' });
  });
});

it('carries a guest-chosen invocation ID through the opaque bridge and rejects a malformed one', async () => {
  const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(fs.existsSync);
  if (!executablePath) throw new Error('Browser qualification requires a real installed Chromium browser');
  const compile = async (source: string) => { const result = await build({ stdin: { contents: source, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2023', logLevel: 'silent' }); return result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'); };
  const hostScript = await compile(`import {AppViewController} from ${JSON.stringify(require.resolve('@ri/app-kit/view-host'))};window.AppViewController=AppViewController;`);
  const guestScript = await compile(`import {connectApp} from ${JSON.stringify(require.resolve('@ri/app-kit/app-client'))};(async()=>{
    const client=await connectApp();
    await client.call('save',{title:'Fictional'},{invocationId:'0192f0aa-1111-7222-8333-444455556666'});
    await client.call('read',{});
    try{await client.app.callServerTool({name:'save',arguments:{},_meta:{'ri/invocationId':'not-a-uuid'}});}catch{}
    await client.call('done',{});
  })();`);
  const guest = prepareHtml(`<html><body><script>${guestScript}</script></body></html>`);
  const server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(`<html><body><div id="mount" style="height:300px"></div><script>${hostScript}</script></body></html>`); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR } });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.evaluate(async ({ guest, id }) => {
      const state = window as unknown as { calls: unknown[]; AppViewController: new (mount: HTMLElement, callbacks: unknown) => { open(resource: unknown, binding: unknown): Promise<void> } };
      state.calls = [];
      const controller = new state.AppViewController(document.getElementById('mount')!, { call: async (action: string, _input: unknown, _signal: AbortSignal, meta?: { invocationId?: string }) => { state.calls.push({ action, meta: meta ?? null }); return {}; }, context: async () => {}, navigate: () => {}, externalLink: () => {}, error: () => {} });
      await controller.open(guest, { id, packageDigest: 'a'.repeat(64), initialData: {}, path: '/', query: {}, theme: 'light' });
    }, { guest, id: randomUUID() });
    await page.waitForFunction(() => (window as unknown as { calls: { action: string }[] }).calls.some(call => call.action === 'done'));
    const calls = await page.evaluate(() => (window as unknown as { calls: unknown[] }).calls);
    expect(calls).toEqual([
      { action: 'save', meta: { invocationId: '0192f0aa-1111-7222-8333-444455556666' } },
      { action: 'read', meta: null },
      { action: 'done', meta: null },
    ]);
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
