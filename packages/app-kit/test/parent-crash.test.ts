import {it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {nodeFixture} from './helpers';
it('hard parent termination reaps a managed process group without stale authority',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ri-app-parent-crash-'));
  let parent:ReturnType<typeof spawn>|undefined;let descendant:number|undefined;
  try{
    const artifact=await nodeFixture(path.join(root,'package'),{descendant:true});const require=createRequire(import.meta.url);const id=randomUUID();
    const source=`import {fixtureHost} from ${JSON.stringify(require.resolve('@ri/app-kit/testing'))};const host=fixtureHost(process.execPath,${JSON.stringify(path.join(root,'records'))});await host.engine.start(host.install(${JSON.stringify(artifact.packageDir)},${JSON.stringify(id)}));process.stdout.write('ready');setInterval(()=>{},1000);`;
    parent=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','pipe'],env:{PATH:path.dirname(process.execPath)}});
    let diagnostic='';parent.stderr!.on('data',chunk=>{diagnostic+=String(chunk).slice(0,4096);});
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Fixture parent did not start')),10000);parent!.stdout!.once('data',()=>{clearTimeout(timer);resolve();});parent!.once('exit',()=>{clearTimeout(timer);reject(new Error('Fixture parent stopped before readiness: '+diagnostic));});});
    descendant=Number(fs.readFileSync(path.join(root,'records',id,'data','descendant.pid'),'utf8'));
    process.kill(descendant,0);process.kill(parent.pid!,'SIGKILL');
    const until=Date.now()+7000;let alive=true;
    while(Date.now()<until){try{process.kill(descendant,0);}catch{alive=false;break;}await new Promise(resolve=>setTimeout(resolve,100));}
    expect(alive).toBe(false);
  }finally{if(parent?.pid){try{process.kill(parent.pid,'SIGKILL');}catch{}}if(descendant){try{process.kill(descendant,'SIGKILL');}catch{}}fs.rmSync(root,{recursive:true,force:true});}
});
