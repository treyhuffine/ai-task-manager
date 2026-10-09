import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { z } from 'zod/v4';
import { generateContract, defineAction } from '@ri/app-kit/sdk';
import { staticFixture } from '@ri/app-kit/testing';
import { validateArtifact } from '@ri/app-kit/build';
export async function nodeFixture(directory:string,options:{hang?:boolean;descendant?:boolean;delay?:number;failedReady?:boolean}={}){
  const artifact=staticFixture(directory,'local-counter');
  const output=z.object({value:z.number()}).strict();
  const actions=[defineAction({name:'increment',description:'Increment a persistent fictional counter',input:z.object({amount:z.number().int()}).strict(),output,audience:['user','agent','schedule'],effect:'app_write',retry:'idempotent',examples:[{input:{amount:1},output:{value:1}}],timeoutMs:options.hang?200:3000,handler:()=>({value:1})}),defineAction({name:'open_view',description:'Read the fictional counter',input:z.object({path:z.string(),query:z.record(z.string(),z.string())}).strict(),output:z.object({resource:z.string(),data:output,scope:z.object({actions:z.array(z.string())}).strict()}).strict(),audience:['user','agent'],effect:'read',retry:'read_safe',examples:[{input:{path:'/',query:{}},output:{resource:'ui://local-counter/main.html',data:{value:0},scope:{actions:['increment']}}}],handler:()=>({resource:'ui://local-counter/main.html',data:{value:0},scope:{actions:['increment']}})})];
  const definition={packageId:'local-counter',version:'0.1.0',actions};
  const contract=generateContract(definition);
  artifact.manifest.extensions['com.ri'].runtime={kind:'node',protocol:'ri-ipc-v1',entry:'dist/server.mjs',start:'on-demand',executionProfile:'trusted-native'};
  artifact.manifest.extensions['com.ri'].ui!.resolveAction='open_view';
  fs.writeFileSync(path.join(directory,'plugin.json'),JSON.stringify(artifact.manifest));
  fs.writeFileSync(path.join(directory,'contract.json'),JSON.stringify(contract));
  const require=createRequire(import.meta.url);
  const sdk=pathToFileURL(require.resolve('@ri/app-kit/sdk')).href;
  const source=`import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {z} from ${JSON.stringify(require.resolve('zod/v4'))};import {serveApp,defineAction,openAppDatabase} from ${JSON.stringify(sdk)};
  let store; const output=z.object({value:z.number()}).strict();
  const definition={packageId:'local-counter',version:'0.1.0',actions:[
    defineAction({name:'increment',description:'Increment a persistent fictional counter',input:z.object({amount:z.number().int()}).strict(),output,audience:['user','agent','schedule'],effect:'app_write',retry:'idempotent',examples:[{input:{amount:1},output:{value:1}}],timeoutMs:${options.hang?200:3000},handler:async(input,ctx)=>{${options.hang?'while(true){}':`await new Promise(r=>setTimeout(r,${options.delay??0}));`}return store.mutate(ctx,'increment',input,()=>{store.db.prepare('UPDATE counter SET value=value+?').run(input.amount);return store.db.prepare('SELECT value FROM counter').get()})}}),
    defineAction({name:'open_view',description:'Read the fictional counter',input:z.object({path:z.string(),query:z.record(z.string(),z.string())}).strict(),output:z.object({resource:z.string(),data:output,scope:z.object({actions:z.array(z.string())}).strict()}).strict(),audience:['user','agent'],effect:'read',retry:'read_safe',examples:[{input:{path:'/',query:{}},output:{resource:'ui://local-counter/main.html',data:{value:0},scope:{actions:['increment']}}}],handler:()=>({resource:'ui://local-counter/main.html',data:store.db.prepare('SELECT value FROM counter').get(),scope:{actions:['increment']}})})
  ]};
  serveApp(definition,{async initialize(boot){store=await openAppDatabase(path.join(boot.dataDir,'records.db'));store.db.exec('CREATE TABLE IF NOT EXISTS counter (value INTEGER NOT NULL); INSERT INTO counter SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM counter)');${options.failedReady?"throw new Error('Fixture readiness failure');":''}fs.writeFileSync(path.join(boot.dataDir,'environment.json'),JSON.stringify({token:process.env.RI_SECRET_PROBE??null,options:process.env.NODE_OPTIONS??null}));${options.descendant?`const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});await new Promise(resolve=>child.stdout.once('data',resolve));fs.writeFileSync(path.join(boot.dataDir,'descendant.pid'),String(child.pid));`:''}},shutdown(){store?.close()}});`;
  // The fixture imports the installed public SDK, not private Ri modules.
  fs.writeFileSync(path.join(directory,'fixture.mjs'),source.replace(sdk,require.resolve('@ri/app-kit/sdk')));
  await build({entryPoints:[path.join(directory,'fixture.mjs')],outfile:path.join(directory,'dist/server.mjs'),bundle:true,format:'esm',platform:'node',target:'node26',banner:{js:'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);'},logLevel:'silent'});
  return validateArtifact(directory);
}
