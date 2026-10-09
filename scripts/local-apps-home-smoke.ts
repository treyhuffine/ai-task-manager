/** Stops and hard-kills only the explicitly named disposable fixture Home. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import Database from 'better-sqlite3';
import {createHomeBackup,verifyHomeBackup,restoreHomeBackup} from '@/lib/home/backup';
import {verifyStoppedAppWriters} from '@/lib/local-apps/backup';
import {getLocalAppsStatePath} from '@/lib/config/paths';
const exec=promisify(execFile);
async function main(){
 const root=process.env.RI_ROOT;assert(root&&!['ri','ri-dev','ri-test'].some(name=>path.resolve(root)===path.join(os.homedir(),name)),'Use an isolated disposable Home');
 const config=JSON.parse(await fs.readFile(path.join(root,'.config/config.json'),'utf8'));assert.equal(config.globalSkillEnabled,false);const runtime=JSON.parse(await fs.readFile(path.join(root,'.work/server-runtime.json'),'utf8')),base=runtime.publicBaseUrl;
 async function rpc(name:string,input:unknown={},mutation=false){const response=await fetch(base+'/api/trpc/'+name+(mutation?'':'?input='+encodeURIComponent(JSON.stringify(input))),{method:mutation?'POST':'GET',headers:{Authorization:'Bearer '+config.localToken,'Content-Type':'application/json'},...(mutation?{body:JSON.stringify(input)}:{})});const result=await response.json();if(!response.ok||result.error)throw new Error(name+' '+(result.error?.message??'Request failed'));return result.result.data;}
 const apps=await rpc('localApps.list');const finance=apps.instances.find((app:{packageId:string})=>app.packageId==='ri-finance');assert(finance?.enabled,'Install synthetic Finance before this probe');
 const task=await rpc('tasks.create',{title:'Keep after local apps removal',rawInput:'Keep after local apps removal'},true),note=await rpc('notes.create',{title:'Keep fixture note after local apps removal',body:'Synthetic note preserved when app state is removed.'},true);
 const backup=await fs.mkdtemp(path.join(os.tmpdir(),'ri-live-app-backup-')),restored=path.join(backup,'restored');
 const manifest=await createHomeBackup({root,outDir:path.join(backup,'snapshot')});assert.deepEqual(verifyHomeBackup(path.join(backup,'snapshot')),{ok:true,problems:[]});assert(manifest.files.some(file=>file.path===`apps/${finance.id}/data/finance.db`));
 restoreHomeBackup({backupDir:path.join(backup,'snapshot'),root:restored});const restoredState=JSON.parse(await fs.readFile(path.join(restored,'.config/local-apps/state.json'),'utf8'));assert(restoredState.instances.every((app:{enabled:boolean})=>!app.enabled));assert(restoredState.grants.every((grant:{revokedAt:string})=>grant.revokedAt));assert.equal(restoredState.panels.length,0);
 const copied=new Database(path.join(restored,'apps',finance.id,'data/finance.db'));try{assert.equal((copied.prepare('SELECT COUNT(*) AS n FROM finance_accounts').get() as {n:number}).n,1);}finally{copied.close();}
 const resumed=await rpc('localApps.list');assert.equal(resumed.instances.find((app:{id:string})=>app.id===finance.id).runtime.condition,'running');
 const draft=await rpc('localApps.createDraft',{profile:'html'},true),dir=path.join(root,'app-drafts',draft.id,'package'),pidFile=path.join(root,'app-drafts',draft.id,'data/build-descendant.pid');
 await fs.mkdir(path.dirname(pidFile),{recursive:true});
 const actions=path.join(dir,'src/actions.ts');await fs.writeFile(actions,`import {spawn} from 'node:child_process';import fs from 'node:fs';if(process.env.RI_APP_BUILD==='1'){const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));while(true){}}\n`+await fs.readFile(actions,'utf8'));
 const building=rpc('localApps.build',{id:draft.id},true).catch(()=>null);
 for(let attempt=0;attempt<400&&!await fs.stat(pidFile).catch(()=>null);attempt++)await new Promise(resolve=>setTimeout(resolve,100));
 const descendant=Number(await fs.readFile(pidFile,'utf8'));
 const listener=(await exec('/usr/sbin/lsof',['-t','-iTCP:'+runtime.publicPort,'-sTCP:LISTEN'])).stdout.trim().split('\n').map(Number);assert.equal(listener.length,1);const command=(await exec('/bin/ps',['-p',String(listener[0]),'-o','command='])).stdout;assert(command.includes('/ri-local-apps/scripts/serve.ts'),'Refuse to kill any other Home process');
 process.kill(listener[0],'SIGKILL');await building;await verifyStoppedAppWriters(root);
 await assert.doesNotReject(async()=>{try{process.kill(descendant,0);throw new Error('An owned descendant survived the Home');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}});
 const offline=await createHomeBackup({root,outDir:path.join(backup,'offline')});assert(offline.files.some(file=>file.path===`apps/${finance.id}/data/finance.db`));
 const core=new Database(path.join(root,'data.db'),{readonly:true});try{assert.equal((core.prepare('SELECT title FROM tasks WHERE id=?').get(task.id) as {title:string}).title,'Keep after local apps removal');assert.equal((core.prepare('SELECT title FROM notes WHERE id=?').get(note.id) as {title:string}).title,'Keep fixture note after local apps removal');}finally{core.close();}
 assert.equal(JSON.parse(await fs.readFile(getLocalAppsStatePath(),'utf8')).instances.length,resumed.instances.length);
 console.log('PASS: running Home stopped backup, service resume, safe restore, hard Home death with building descendant, offline writer verification and retained core records');
 console.log('Disposable backup evidence: '+backup);
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
