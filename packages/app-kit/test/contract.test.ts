import { describe,it,expect,afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { ContractValidator,slugSchema } from '@ri/app-kit/contract';
import { staticFixture } from '@ri/app-kit/testing';
import { validateArtifact,exportPackage,importPackage,prepareHtml,inventory } from '@ri/app-kit/build';
const dirs:string[]=[];
function root(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ri-app-contract-'));dirs.push(dir);return dir;}
afterEach(()=>{for(const dir of dirs.splice(0))fs.rmSync(dir,{recursive:true,force:true});});
describe('portable artifacts',()=>{
  it('rejects malformed guest JavaScript before activation',()=>{
    expect(()=>prepareHtml('<script>function broken( {</script>')).toThrow(/invalid JavaScript/);
    expect(()=>prepareHtml('<script type="module">export function broken( {</script>')).toThrow(/invalid JavaScript/);
    expect(prepareHtml('<script type="module">export const value = 1;</script>').scriptHashes).toHaveLength(1);
    expect(prepareHtml('<script>const template = `$` + "literal";</script>').scriptHashes).toHaveLength(1);
  });
  it('inventories qualified runtime dependencies under dist while excluding build dependencies',()=>{
    const dir=root();fs.mkdirSync(path.join(dir,'dist/node_modules/sqlite'),{recursive:true});fs.mkdirSync(path.join(dir,'node_modules/build-only'),{recursive:true});
    fs.writeFileSync(path.join(dir,'dist/node_modules/sqlite/native.node'),'native fixture');fs.writeFileSync(path.join(dir,'node_modules/build-only/index.js'),'build fixture');
    expect(inventory(dir).map(file=>file.name)).toEqual(['dist/node_modules/sqlite/native.node']);
  });
  it('exports source and imports a fresh artifact without private records',async()=>{
    const dir=root(),source=path.join(dir,'package');const artifact=staticFixture(source);
    fs.mkdirSync(path.join(source,'data'));fs.writeFileSync(path.join(source,'data','private.txt'),'fictional personal record');fs.writeFileSync(path.join(source,'.env'),'SECRET=fixture');
    const archive=path.join(dir,'app.tgz');const files=await exportPackage(artifact,archive);
    expect(files.some(file=>file.name.startsWith('data/')||file.name==='.env')).toBe(false);
    const imported=await importPackage(archive,path.join(dir,'import'));expect(imported.digest).toBe(artifact.digest);
    expect(fs.existsSync(path.join(dir,'import','data'))).toBe(false);
  });
  it('rejects symlinks, traversal and executable unknown profiles before launch',async()=>{
    const dir=root(),artifact=staticFixture(path.join(dir,'package'));
    fs.symlinkSync('/etc/hosts',path.join(artifact.packageDir,'escape'));
    expect(()=>validateArtifact(artifact.packageDir)).toThrow(/symbolic links/);
    const validator=new ContractValidator(),manifest=structuredClone(artifact.manifest);
    (manifest.extensions['com.ri'].build as unknown as {executionProfile:string}).executionProfile='hostile';
    expect(()=>validator.manifest(manifest)).toThrow();
    expect(slugSchema.safeParse('new').success).toBe(false);expect(slugSchema.safeParse('../app').success).toBe(false);
    const archive=path.join(dir,'unsafe.tgz');await tar.c({file:archive,gzip:true,cwd:artifact.packageDir},['escape']);
    await expect(importPackage(archive,path.join(dir,'unsafe'))).rejects.toThrow(/unsafe/);
    expect(fs.existsSync(path.join(dir,'unsafe'))).toBe(false);
  });
  it('preserves inert extension namespaces and rejects invalid fixtures',()=>{
    const artifact=staticFixture(path.join(root(),'package')),manifest=structuredClone(artifact.manifest);
    manifest.extensions['example.other']={command:'do not execute'};
    expect(new ContractValidator().manifest(manifest).extensions['example.other']).toEqual({command:'do not execute'});
    const contract=structuredClone(artifact.contract);contract.actions.push({name:'oops',description:'fixture',inputSchema:{type:'object',additionalProperties:false},outputSchema:{type:'number'},audience:['user'],effect:'read',timeoutMs:30,retry:'read_safe',visibility:'both',errors:[],examples:[{input:{},output:'bad'}]});
    manifest.extensions['com.ri'].runtime={kind:'node',protocol:'ri-ipc-v1',entry:'dist/server.mjs',start:'on-demand',executionProfile:'trusted-native'};manifest.extensions['com.ri'].ui.resolveAction='oops';
    expect(()=>new ContractValidator().contract(contract,manifest)).toThrow(/output fixture/);
  });
  it.each(['<script src="https://example.com/x.js"></script>','<iframe srcdoc="bad"></iframe>','<meta http-equiv="refresh" content="0;url=https://example.com">','<img src="/api/private">','<style>@import "https://example.com"</style>','<button onclick="fetch(1)">Bad</button>'])('rejects unsupported network resource %s',html=>{expect(()=>prepareHtml(html)).toThrow();});
});

it('accepts tools-only Node contracts on both adapters and rejects empty tools or viewless open paths', () => {
  const artifact = staticFixture(path.join(root(), 'headless'));
  const manifest = structuredClone(artifact.manifest);
  const contract = structuredClone(artifact.contract);
  delete manifest.extensions['com.ri'].ui;
  manifest.extensions['com.ri'].runtime = { kind: 'node', protocol: 'ri-ipc-v1', entry: 'dist/server.mjs', start: 'on-demand', executionProfile: 'trusted-native' };
  const validator = new ContractValidator();
  expect(() => validator.manifest(manifest)).not.toThrow();
  expect(() => validator.contract(contract, manifest)).toThrow(/at least one action/);
  contract.actions.push({ name: 'read', description: 'Read fixture', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, audience: ['agent'], effect: 'read', timeoutMs: 1000, retry: 'read_safe', visibility: 'model', errors: [], examples: [{ input: {}, output: {} }] });
  expect(() => validator.contract(contract, manifest)).not.toThrow();
  manifest.extensions['com.ri'].runtime = { ...manifest.extensions['com.ri'].runtime, protocol: 'mcp-http-v1', mcpPath: '/mcp', target: { platform: process.platform as 'darwin', arch: process.arch as 'arm64', nodeVersion: process.versions.node, nodeAbi: process.versions.modules } };
  manifest.extensions['com.ri'].build = { adapter: 'next-standalone-v1', executionProfile: 'trusted-native', lockfile: 'pnpm-lock.yaml', recipe: 'build.json', output: 'release/service' };
  expect(() => validator.manifest(manifest)).not.toThrow();
  expect(() => validator.contract(contract, manifest)).not.toThrow();
});
