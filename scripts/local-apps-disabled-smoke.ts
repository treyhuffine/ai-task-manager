import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyStoppedAppWriters} from '@/lib/local-apps/backup';
async function main(){
 const root=process.env.RI_ROOT;assert(root);assert(root.includes('local-apps-fixture-home'),'Use only the named disposable qualification Home');const backup=process.argv[2];assert(backup,'Supply the offline backup recorded before disabled startup');
 const config=JSON.parse(await fs.readFile(path.join(root,'.config/config.json'),'utf8')),record=JSON.parse(await fs.readFile(path.join(root,'.work/server-runtime.json'),'utf8'));
 const get=async(name:string)=>{const response=await fetch(record.publicBaseUrl+'/api/trpc/'+name,{headers:{Authorization:'Bearer '+config.localToken}});return {status:response.status,body:await response.json()};};
 const enabled=await get('localApps.enabled');assert.deepEqual(enabled.body.result.data,{enabled:false});const list=await get('localApps.list');assert(list.status>=400);
 const original=await fs.readFile(path.join(backup,'.config/local-apps/state.json')),current=await fs.readFile(path.join(root,'.config/local-apps/state.json'));assert.equal(createHash('sha256').update(current).digest('hex'),createHash('sha256').update(original).digest('hex'),'Disabled startup wrote app metadata');await verifyStoppedAppWriters(root);
 assert.equal((await get('tasks.list')).status,200);assert.equal((await get('notes.list')).status,200);assert.equal((await get('sessions.railGet')).status,200);console.log('PASS: disabled Home rejects app operations, preserves app metadata, has no owned writers and serves tasks, notes and chats');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
