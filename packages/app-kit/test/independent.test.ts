import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {it,expect} from 'vitest';
import {runtimeEnvironment} from '@ri/app-kit/runtime';
import {nodeFixture} from './helpers';
const exec=promisify(execFile);
it('installs the packed kit in a clean consumer and exercises the ordinary MCP projection',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ri-kit-consumer-')),consumer=path.join(dir,'consumer'),require=createRequire(import.meta.url),kit=path.resolve(path.dirname(require.resolve('@ri/app-kit/sdk')),'..'),pnpm=path.join(path.dirname(require.resolve('pnpm')),'bin/pnpm.cjs');
 try{fs.mkdirSync(consumer);const artifact=await nodeFixture(path.join(dir,'artifact'));await exec(process.execPath,[pnpm,'pack','--pack-destination',dir],{cwd:kit,env:runtimeEnvironment(process.execPath,dir),maxBuffer:1024*1024});
  fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({name:'independent-app-host',version:'1.0.0',private:true,type:'module',dependencies:{'@ri/app-kit':'file:../ri-app-kit-0.1.0.tgz'}}));
  await exec(process.execPath,[pnpm,'install','--ignore-scripts'],{cwd:consumer,env:runtimeEnvironment(process.execPath,dir),timeout:120000,maxBuffer:1024*1024});
  fs.writeFileSync(path.join(consumer,'run.mjs'),`import {fixtureHost,createFixtureMcpServer,standardFixtureClient} from '@ri/app-kit/testing';import path from 'node:path';const host=fixtureHost(process.execPath,path.join(process.cwd(),'fixture-data')),instance=host.install(process.argv[2],crypto.randomUUID()),connection=await standardFixtureClient(createFixtureMcpServer(host.engine,instance));try{const tools=await connection.client.listTools();const result=await connection.client.callTool({name:'increment',arguments:{amount:7}});const resources=await connection.client.listResources();const resource=await connection.client.readResource({uri:resources.resources[0].uri});process.stdout.write(JSON.stringify({names:tools.tools.map(tool=>tool.name),value:result.structuredContent.value,html:resource.contents[0].text}));}finally{await connection.close();await host.engine.dispose();}`);
  const result=await exec(process.execPath,['run.mjs',artifact.packageDir],{cwd:consumer,env:runtimeEnvironment(process.execPath,path.join(dir,'clean-home')),timeout:30000,maxBuffer:1024*1024});
  expect(JSON.parse(result.stdout)).toMatchObject({names:['increment','open_view'],value:7,html:expect.stringContaining('Reference')});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
},180000);
