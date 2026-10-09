import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {createAppTemplate} from '@ri/app-kit/build';
it('hard build-parent termination reaps stubborn dependency descendants',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ri-build-crash-')),packageDir=path.join(root,'package');let parent:ReturnType<typeof spawn>|undefined,descendant:number|undefined;
  try{
    await createAppTemplate(packageDir,'react',randomUUID());
    fs.writeFileSync(path.join(packageDir,'src/actions.ts'),`import {spawn} from 'node:child_process';import fs from 'node:fs';const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});await new Promise(resolve=>child.stdout.once('data',resolve));fs.writeFileSync(${JSON.stringify(path.join(root,'child.pid'))},String(child.pid));await new Promise(()=>{});export const definition={};`);
    const require=createRequire(import.meta.url),source=`import {buildPackage} from ${JSON.stringify(require.resolve('@ri/app-kit/build'))};import {NativeNodeDriver} from ${JSON.stringify(require.resolve('@ri/app-kit/runtime'))};await buildPackage({packageDir:${JSON.stringify(packageDir)},driver:new NativeNodeDriver(process.execPath)});`;
    parent=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','ignore','pipe'],env:{PATH:path.dirname(process.execPath)}});
    let diagnostics='';parent.stderr!.on('data',chunk=>diagnostics+=String(chunk).slice(0,2048));
    const deadline=Date.now()+30000;while(!fs.existsSync(path.join(root,'child.pid'))&&Date.now()<deadline){if(parent.exitCode!==null)throw new Error('Build exited early: '+diagnostics);await new Promise(resolve=>setTimeout(resolve,100));}
    expect(fs.existsSync(path.join(root,'child.pid'))).toBe(true);descendant=Number(fs.readFileSync(path.join(root,'child.pid'),'utf8'));process.kill(descendant,0);
    const ownership=JSON.parse(fs.readFileSync(path.join(root,'cache/ownership.json'),'utf8'));expect(ownership.generation).toMatch(/^[a-f0-9-]+$/);
    process.kill(parent.pid!,'SIGKILL');let alive=true;const until=Date.now()+7000;while(Date.now()<until){try{process.kill(descendant,0);}catch{alive=false;break;}await new Promise(resolve=>setTimeout(resolve,100));}expect(alive).toBe(false);
  }finally{if(parent?.pid)try{process.kill(parent.pid,'SIGKILL');}catch{}if(descendant)try{process.kill(descendant,'SIGKILL');}catch{}fs.rmSync(root,{recursive:true,force:true});}
},45000);
