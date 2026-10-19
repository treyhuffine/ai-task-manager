import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { prepareResource } from './resource';

const probe = `
const report=()=>{let parentBlocked=false,storageBlocked=false;try{void parent.parent.document.body}catch{parentBlocked=true}try{localStorage.getItem('private')}catch{storageBlocked=true}
const bounds=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}};
return {input:document.getElementById('input').textContent,total:document.getElementById('total').textContent,private:document.getElementById('private').textContent,parentBlocked,storageBlocked,desktop:typeof window.riDesktop,update:bounds('update'),expand:bounds('expand')};};
`;
const standard = `${probe}
let sequence=0;const awaiting=new Map();
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;awaiting.set(id,{resolve,reject});parent.postMessage({jsonrpc:'2.0',id,method,params},'*')});
const notify=(method,params)=>parent.postMessage({jsonrpc:'2.0',method,params},'*');
addEventListener('message',event=>{if(event.source!==parent)return;const m=event.data;if(m.id&&awaiting.has(m.id)){const p=awaiting.get(m.id);awaiting.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}
if(m.method==='ui/notifications/tool-input')document.getElementById('input').textContent=String(m.params.arguments.amount);
if(m.method==='ui/notifications/tool-result'){document.getElementById('total').textContent=String(m.params.structuredContent.total);document.getElementById('private').textContent=m.params._meta.privateUi;rpc('tools/call',{name:'fixture_probe',arguments:report()});}
});
document.getElementById('update').onclick=async()=>{const res=await rpc('tools/call',{name:'filter',arguments:{amount:9}});document.getElementById('total').textContent=String(res.structuredContent.total);await rpc('ui/update-model-context',{content:[{type:'text',text:'Selected 9'}],structuredContent:{selected:9}});await rpc('ui/message',{role:'user',content:[{type:'text',text:'Explain this selection'}]});notify('ui/notifications/size-changed',{height:350});await rpc('tools/call',{name:'fixture_probe',arguments:report()});};
document.getElementById('expand').onclick=()=>rpc('ui/request-display-mode',{mode:'fullscreen'});
rpc('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Independent fixture',version:'1.0.0'},appCapabilities:{}}).then(()=>notify('ui/notifications/initialized',{}));
`;
const legacy = `${probe}
const render=()=>{document.getElementById('input').textContent=String(window.openai.toolInput.amount??'');document.getElementById('total').textContent=String(window.openai.toolOutput?.total??'');document.getElementById('private').textContent=window.openai.toolResponseMetadata.privateUi??'';if(window.openai.toolOutput?.total)window.openai.callTool('fixture_probe',report());};
addEventListener('openai:set_globals',render);render();
document.getElementById('update').onclick=async()=>{const res=await window.openai.callTool('filter',{amount:9});document.getElementById('total').textContent=String(res.structuredContent.total);await window.openai.setWidgetState({selected:9});await window.openai.sendFollowUpMessage({prompt:'Explain this selection'});await window.openai.callTool('fixture_probe',report());};
document.getElementById('expand').onclick=()=>window.openai.requestDisplayMode({mode:'fullscreen'});
`;
const markup = (script: string) => `<html><head><style>body{font:16px system-ui;padding:20px;background:#fff;color:#17212c}button{padding:8px;margin:4px}output{display:block}</style></head><body><h1>Independent calculator</h1><output id="input"></output><output id="total"></output><output id="private"></output><button id="update">Recalculate</button><button id="expand">Expand</button><script>${script}</script></body></html>`;

for (const profile of ['standard', 'legacy'] as const) it(`hosts ${profile} MCP UI with the original envelope, actions, context and display changes in an opaque sandbox`, async () => {
  const executablePath = [chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync);
  if (!executablePath) throw new Error('MCP UI qualification requires Chromium');
  const require = createRequire(import.meta.url);
  const output = await build({stdin: {contents: `import {AppViewController} from ${JSON.stringify(require.resolve('@ri/mcp-apps-host'))};window.AppViewController=AppViewController;`, resolveDir: process.cwd()}, bundle: true, write: false, metafile: true, format: 'iife', platform: 'browser'});
  expect(Object.keys(output.metafile!.inputs).some(file => file.includes('packages/app-kit/'))).toBe(false);
  const host = output.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const server = createServer((_req,res) => {res.setHeader('Content-Type','text/html');res.end(`<html><body><div id="view" style="height:500px"></div><script>${host}</script></body></html>`);});
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address() as {port: number};
  const browser = await chromium.launch({executablePath, headless: true, chromiumSandbox: true, env: {PATH: process.env.PATH, TMPDIR: process.env.TMPDIR}});
  try {
    const page = await browser.newPage(); const errors: string[] = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    const uri = 'ui://fixture/calculator.html';
    const prepared = prepareResource({contents: [{uri, mimeType: profile === 'legacy' ? 'text/html+skybridge' : 'text/html;profile=mcp-app', text: markup(profile === 'legacy' ? legacy : standard)}]}, uri, profile === 'legacy');
    await page.evaluate(async ({prepared,id}) => {
      const state = window as unknown as {AppViewController: new (...args: unknown[]) => {open(...args: unknown[]): Promise<void>}; controller: unknown; calls: unknown[]; observations: unknown[]; contexts: unknown[]; messages: string[]; modes: string[]; errors: string[]; binding: unknown};
      Object.assign(state,{calls: [],observations: [],contexts: [],messages: [],modes: [],errors: []});
      const controller = new state.AppViewController(document.getElementById('view'), {
        call: async (name: string, args: unknown) => {if(name==='fixture_probe'){state.observations.push(args);return {content:[]}}state.calls.push({name,args});return {content: [{type:'text',text:'Updated'}],structuredContent:{total:90},_meta:{privateUi:'private follow-up'}};},
        context: async (value: unknown) => {state.contexts.push(value);}, message: (text: string) => state.messages.push(text), displayMode: (mode: string) => state.modes.push(mode),
        navigate: () => {}, externalLink: () => {}, error: (error: Error) => state.errors.push(error.message),
      }); state.controller = controller;
      state.binding = {id, packageDigest: prepared.digest, path:'/',query:{},theme:'light',initialData:null,mcp:{input:{amount:7},result:{content:[{type:'text',text:'Public summary'}],structuredContent:{total:70},_meta:{privateUi:'only the interface'}}}};
      await controller.open(prepared,state.binding);
    }, {prepared,id:randomUUID()});
    // Observe this independent guest through its ordinary tool call. Chromium
    // can omit a deeply nested opaque frame from the automation frame tree even
    // while it renders. Physical pointer input still exercises the actual UI.
    type Observation = {input:string;total:string;private:string;parentBlocked:boolean;storageBlocked:boolean;desktop:string;update:{x:number;y:number};expand:{x:number;y:number}};
    await page.waitForFunction(() => (window as unknown as {observations:unknown[]}).observations.length > 0);
    const initial = await page.evaluate(() => (window as unknown as {observations:Observation[]}).observations[0]);
    expect(initial).toMatchObject({input:'7',total:'70',private:'only the interface',parentBlocked:true,storageBlocked:true,desktop:'undefined'});
    const frame = await page.locator('#view > iframe').boundingBox();
    await page.mouse.click(frame!.x+initial.update.x,frame!.y+initial.update.y);
    await page.waitForFunction(() => (window as unknown as {observations:{total:string}[]}).observations.some(value => value.total === '90'));
    await page.mouse.click(frame!.x+initial.expand.x,frame!.y+initial.expand.y);
    await page.waitForFunction(() => (window as unknown as {modes: string[]}).modes.length === 1);
    const state = await page.evaluate(() => {const w=window as unknown as {calls: unknown[]; observations: unknown[]; contexts: unknown[]; messages: string[]; modes: string[]; errors: string[]};return {calls:w.calls,contexts:w.contexts,messages:w.messages,modes:w.modes,errors:w.errors};});
    expect(state.calls).toEqual([{name:'filter',args:{amount:9}}]); expect(state.contexts).toHaveLength(1); expect(state.messages).toEqual(['Explain this selection']); expect(state.modes).toEqual(['fullscreen']); expect(state.errors).toEqual([]); expect(errors).toEqual([]);
    await page.setViewportSize({width:390,height:844});
    expect(await page.locator('#view > iframe').isVisible()).toBe(true);
    await page.screenshot({path:`/tmp/ri-mcp-${profile}-mobile.png`});
    const observed = await page.evaluate(() => (window as unknown as {observations:unknown[]}).observations.length);
    await page.evaluate(async prepared => {const w=window as unknown as {controller:{open(...args:unknown[]):Promise<void>};binding:unknown};await w.controller.open(prepared,w.binding);},prepared);
    await page.waitForFunction(count => (window as unknown as {observations:unknown[]}).observations.length > count,observed);
    expect(await page.evaluate(() => (window as unknown as {calls:unknown[]}).calls.length)).toBe(1);
  } finally {await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()));}
},30_000);

// A guest written the way OpenAI's app SDK talks to a host: it reads the
// extensions from `hostCapabilities.experimental` and `hostContext`, and
// reports what it saw through an ordinary tool call.
const extensionsGuest = `
let sequence=0;const awaiting=new Map();const seen=[];
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;awaiting.set(id,{resolve,reject});parent.postMessage({jsonrpc:'2.0',id,method,params},'*')});
const notify=(method,params)=>parent.postMessage({jsonrpc:'2.0',method,params},'*');
const report=value=>rpc('tools/call',{name:'fixture_probe',arguments:value});
addEventListener('message',event=>{if(event.source!==parent)return;const m=event.data;if(m.id&&awaiting.has(m.id)){const p=awaiting.get(m.id);awaiting.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);return}
if(m.method==='ui/notifications/host-context-changed')report({changed:m.params});
});
rpc('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Extensions fixture',version:'1.0.0'},appCapabilities:{}}).then(async init=>{
  notify('ui/notifications/initialized',{});
  const read=await rpc('resources/read',{uri:'cad-resource://bits-and-bolts/occt-import-js.wasm'});
  const context=await rpc('ui/update-model-context',{content:[{type:'text',text:'Selected: agent dial',_meta:{'openai/title':'Agent dial'}}]});
  let fullscreen='allowed';try{await rpc('ui/request-display-mode',{mode:'fullscreen'})}catch(error){fullscreen=error.message}
  let write='allowed';try{await rpc('openai/resources/write',{uri:'ri-file:x',text:'x'})}catch(error){write=error.message}
  await report({capabilities:init.hostCapabilities,context:init.hostContext,read,update:context,fullscreen,write});
});
`;

it('advertises OpenAI extensions only as the page supports them, and carries host context, resource reads and update IDs', async () => {
  const executablePath = [chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync);
  if (!executablePath) throw new Error('MCP UI qualification requires Chromium');
  const require = createRequire(import.meta.url);
  const output = await build({stdin: {contents: `import {AppViewController} from ${JSON.stringify(require.resolve('@ri/mcp-apps-host'))};window.AppViewController=AppViewController;`, resolveDir: process.cwd()}, bundle: true, write: false, format: 'iife', platform: 'browser'});
  const host = output.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const server = createServer((_req,res) => {res.setHeader('Content-Type','text/html');res.end(`<html><body><div id="view" style="height:400px"></div><script>${host}</script></body></html>`);});
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({executablePath, headless: true, chromiumSandbox: true, env: {PATH: process.env.PATH, TMPDIR: process.env.TMPDIR}});
  try {
    const page = await browser.newPage(); const errors: string[] = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as {port: number}).port}`);
    const uri = 'ui://bits-and-bolts/global-v35';
    const prepared = prepareResource({contents: [{uri, mimeType: 'text/html;profile=mcp-app', text: `<html><body><p>Library</p><script>${extensionsGuest}</script></body></html>`, _meta: {'openai/ui': {availableDisplayModes: ['inline']}}}]}, uri, false);
    expect(prepared.displayModes).toEqual({available: ['inline'], declared: true});
    await page.evaluate(async ({prepared, id}) => {
      const state = window as unknown as {AppViewController: new (...args: unknown[]) => {open(...args: unknown[]): Promise<void>; hostContextChanged(changes: unknown): void}; controller: unknown; reports: unknown[]; reads: unknown[]; contexts: unknown[]};
      Object.assign(state, {reports: [], reads: [], contexts: []});
      const controller = new state.AppViewController(document.getElementById('view'), {
        call: async (name: string, args: unknown) => {if (name === 'fixture_probe') state.reports.push(args); return {content: []};},
        context: async (value: unknown) => {state.contexts.push(value); return {updateId: 'update-1'};},
        readResource: async (params: unknown) => {state.reads.push(params); return {contents: [{uri: 'cad-resource://bits-and-bolts/occt-import-js.wasm', mimeType: 'application/wasm', blob: 'AGFzbQ=='}]};},
        modelContext: true, displayMode: () => {}, sendMessage: async () => {},
        navigate: () => {}, externalLink: () => {}, error: () => {},
      });
      state.controller = controller;
      await controller.open(prepared, {id, packageDigest: prepared.digest, path: '/', query: {}, theme: 'dark', initialData: null, mcp: {input: {}, result: {content: []}},
        displayModes: prepared.displayModes.available, hostContext: {'openai/deepLink': {url: '/parts?tag=bolt&sort=asc'}, 'openai/modelContext': null}});
    }, {prepared, id: randomUUID()});
    await page.waitForFunction(() => (window as unknown as {reports: unknown[]}).reports.length > 0);
    const [first] = await page.evaluate(() => (window as unknown as {reports: unknown[]}).reports) as {capabilities: Record<string, unknown>; context: Record<string, unknown>; read: unknown; update: unknown; fullscreen: string; write: string}[];
    // Model context and message are offered, an opened file and file opening are not, and resource reads are relayed.
    expect(first.capabilities).toMatchObject({experimental: {'openai/modelContext': {}, 'openai/message': {}}, serverResources: {},
      updateModelContext: {text: {}, image: {}, resourceLink: {}, resource: {}, structuredContent: {}}, message: {text: {}, image: {}, resourceLink: {}, resource: {}}});
    expect(first.capabilities.experimental).not.toHaveProperty('openai/resource');
    expect(first.capabilities.experimental).not.toHaveProperty('openai/files');
    expect(first.context).toMatchObject({platform: 'web', theme: 'dark', availableDisplayModes: ['inline'], 'openai/deepLink': {url: '/parts?tag=bolt&sort=asc'}, 'openai/modelContext': null});
    expect(first.read).toEqual({contents: [{uri: 'cad-resource://bits-and-bolts/occt-import-js.wasm', mimeType: 'application/wasm', blob: 'AGFzbQ=='}]});
    expect(first.update).toEqual({_meta: {'openai/modelContext': {updateId: 'update-1'}}});
    expect(first.fullscreen).toMatch(/unavailable/);
    expect(first.write).toMatch(/not found|unavailable|Method/i);
    // A deep link to the open screen arrives as a host context change.
    await page.evaluate(() => (window as unknown as {controller: {hostContextChanged(changes: unknown): void}}).controller.hostContextChanged({'openai/deepLink': {url: '/parts/hex-bolt'}}));
    await page.waitForFunction(() => (window as unknown as {reports: unknown[]}).reports.length > 1);
    expect((await page.evaluate(() => (window as unknown as {reports: unknown[]}).reports))[1]).toEqual({changed: {'openai/deepLink': {url: '/parts/hex-bolt'}}});
    expect(errors).toEqual([]);
  } finally {await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()));}
}, 30_000);

// What an app written for ChatGPT does that a locked-down frame used to refuse: a form whose
// submit handler runs (Bits & Bolts' Create part), WebAssembly, and a worker it builds from a
// blob (its STEP importer). The network stays closed to the view and to its worker, and a form
// that is not cancelled, or submitted programmatically, leaves the view running.
const capableGuest = `
let sequence=0;const awaiting=new Map();
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;awaiting.set(id,{resolve,reject});parent.postMessage({jsonrpc:'2.0',id,method,params},'*')});
const notify=(method,params)=>parent.postMessage({jsonrpc:'2.0',method,params},'*');
const report=value=>rpc('tools/call',{name:'fixture_probe',arguments:value});
addEventListener('message',event=>{if(event.source!==parent)return;const m=event.data;if(m.id&&awaiting.has(m.id)){const p=awaiting.get(m.id);awaiting.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}});
rpc('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Capable fixture',version:'1.0.0'},appCapabilities:{}}).then(async()=>{
  notify('ui/notifications/initialized',{});
  let submitted=false;const form=document.getElementById('create');form.addEventListener('submit',()=>{submitted=true});form.requestSubmit();form.submit();await new Promise(r=>setTimeout(r,300));
  let wasm='refused';try{const bytes=new Uint8Array([0,97,115,109,1,0,0,0]);await WebAssembly.instantiate(bytes);wasm='compiled'}catch(error){wasm=String(error.message||error).slice(0,80)}
  let worker='refused';try{const url=URL.createObjectURL(new Blob(['onmessage=e=>postMessage(e.data*2)'],{type:'text/javascript'}));const w=new Worker(url);worker=await new Promise((resolve,reject)=>{w.onmessage=e=>resolve(String(e.data));w.onerror=()=>reject(new Error('worker failed'));setTimeout(()=>reject(new Error('worker timed out')),3000);w.postMessage(21)})}catch(error){worker=String(error.message||error).slice(0,80)}
  let network='open';try{await fetch('https://example.com/');}catch{network='closed'}
  await report({submitted,wasm,worker,network});
});
`;

it('runs form handlers, WebAssembly and blob workers inside the view, with the network still closed', async () => {
  const executablePath = [chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync);
  if (!executablePath) throw new Error('MCP UI qualification requires Chromium');
  const require = createRequire(import.meta.url);
  const output = await build({stdin: {contents: `import {AppViewController} from ${JSON.stringify(require.resolve('@ri/mcp-apps-host'))};window.AppViewController=AppViewController;`, resolveDir: process.cwd()}, bundle: true, write: false, format: 'iife', platform: 'browser'});
  const host = output.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const server = createServer((_req,res) => {res.setHeader('Content-Type','text/html');res.end(`<html><body><div id="view" style="height:300px"></div><script>${host}</script></body></html>`);});
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({executablePath, headless: true, chromiumSandbox: true, env: {PATH: process.env.PATH, TMPDIR: process.env.TMPDIR}});
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${(server.address() as {port: number}).port}`);
    const uri = 'ui://fixture/capable.html';
    const prepared = prepareResource({contents: [{uri, mimeType: 'text/html;profile=mcp-app', text: `<html><body><form id="create"><input name="part" value="washer"><button>Create</button></form><script>${capableGuest}</script></body></html>`}]}, uri, false);
    await page.evaluate(async ({prepared, id}) => {
      const state = window as unknown as {AppViewController: new (...args: unknown[]) => {open(...args: unknown[]): Promise<void>}; reports: unknown[]};
      state.reports = [];
      const controller = new state.AppViewController(document.getElementById('view'), {
        call: async (name: string, args: unknown) => {if (name === 'fixture_probe') state.reports.push(args); return {content: []};},
        context: async () => {}, navigate: () => {}, externalLink: () => {}, error: () => {},
      });
      await controller.open(prepared, {id, packageDigest: prepared.digest, path: '/', query: {}, theme: 'light', initialData: null, mcp: {input: {}, result: {content: []}}});
    }, {prepared, id: randomUUID()});
    await page.waitForFunction(() => (window as unknown as {reports: unknown[]}).reports.length > 0, undefined, {timeout: 15_000});
    expect((await page.evaluate(() => (window as unknown as {reports: unknown[]}).reports))[0]).toEqual({submitted: true, wasm: 'compiled', worker: '42', network: 'closed'});
  } finally {await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()));}
}, 30_000);
