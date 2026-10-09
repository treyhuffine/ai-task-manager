import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterEach, expect, it, vi} from 'vitest';
import {LocalAppsService} from './service';
import type {AppInstance, AppGrant, AppSchedule} from './state';

vi.mock('@/lib/service/maintenance', () => ({beginActivity: () => () => {}}));
let root: string;
let service: LocalAppsService;
const stamp = '2026-10-07T12:00:00.000Z';
function instance(): AppInstance {
  const id = randomUUID();
  return {id, createdAt:stamp, updatedAt:stamp, slug:'app-'+id.slice(0,8), packageId:'local-'+id.slice(0,8), version:'0.1.0', digest:'a'.repeat(64), enabled:true, archived:false, customized:false, changeRevision:0, provenance:{kind:'personal',packageId:'local-fixture',version:'0.1.0',sourceDigest:'b'.repeat(64)}, activation:{phase:'active',previousDigest:null,nextDigest:'a'.repeat(64),snapshotId:null,replacementId:randomUUID()}};
}
function grant(app: AppInstance, kind: AppGrant['principal']['kind'], id: string): AppGrant {
  return {id:randomUUID(),createdAt:stamp,updatedAt:stamp,instanceId:app.id,principal:{kind,id},actions:['read_records'],riActions:[],connections:[],serviceScopeRef:null,revision:1,revokedAt:null};
}
async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(),'ri-app-authority-'));
  process.env.RI_ROOT=root;
  process.env.RI_LOCAL_APPS='1';
  service = new LocalAppsService(id => id==='active-chat' ? {status:'active',workspaceId:'agent-a'} : id==='archived-chat' ? {status:'archived',workspaceId:'agent-a'} : null);
  await service.store.initialize();
}
afterEach(async () => {await service?.dispose();if(root)await fs.rm(root,{recursive:true,force:true});delete process.env.RI_ROOT;delete process.env.RI_LOCAL_APPS;vi.restoreAllMocks();});
it('derives agent membership from the chat and keeps explicit chat choices narrower',async () => {
  await setup();
  const app=instance(), agent=grant(app,'workspace','agent-a');
  await service.store.edit(undefined,state=>{state.instances.push(app);state.grants.push(agent);});
  expect(service.grant(app.id,{kind:'chat',id:'active-chat'}).id).toBe(agent.id);
  expect(()=>service.grant(app.id,{kind:'chat',id:'unrelated-chat'})).toThrow(/no longer available/);
  expect(()=>service.grant(app.id,{kind:'chat',id:'archived-chat'})).toThrow(/no longer available/);
  const direct=grant(app,'chat','active-chat');direct.actions=[];
  await service.store.edit(undefined,state=>{state.grants.push(direct);});
  expect(service.grant(app.id,{kind:'chat',id:'active-chat'}).actions).toEqual([]);
  await service.store.edit(undefined,state=>{state.grants.find(item=>item.id===direct.id)!.revokedAt=stamp;});
  expect(()=>service.grant(app.id,{kind:'chat',id:'active-chat'})).toThrow(/no grant/);
});
it('claims at most twenty overdue slots, runs once per instance and records overlap and active-hours skips',async () => {
  await setup();
  const apps=Array.from({length:3},instance), jobs:AppSchedule[]=[], grants:AppGrant[]=[];
  for(let i=0;i<30;i++) {
    const app=apps[Math.floor(i/10)], id=randomUUID(), permission=grant(app,'job',id);
    grants.push(permission);
    jobs.push({id,createdAt:stamp,updatedAt:stamp,instanceId:app.id,action:'read_records',input:{},cron:'* * * * *',timezone:'UTC',activeHours:null,enabled:true,nextRunAt:'2026-10-06T12:00:00.000Z',grantId:permission.id,runningInvocationId:null});
  }
  jobs[0].activeHours={start:'01:00',end:'02:00'};
  await service.store.edit(undefined,state=>{state.instances.push(...apps);state.grants.push(...grants);state.schedules.push(...jobs);});
  const invoke=vi.spyOn(service,'call').mockResolvedValue({});
  await service.tick(new Date(stamp));
  expect(invoke).toHaveBeenCalledTimes(2);
  const state=service.store.read();
  expect(state.invocations).toHaveLength(20);
  expect(state.invocations.filter(item=>item.outcome==='skipped_overlap')).toHaveLength(17);
  expect(state.invocations.filter(item=>item.outcome==='skipped_active_hours')).toHaveLength(1);
  expect(state.invocations.every(item=>item.slot==='2026-10-06T12:00:00.000Z')).toBe(true);
  expect(state.schedules.filter(item=>item.nextRunAt > stamp)).toHaveLength(20);
  await new Promise(resolve=>setTimeout(resolve,20));
  await service.tick(new Date(stamp));
  expect(invoke).toHaveBeenCalledTimes(3);
  expect(service.store.read().schedules.every(item=>item.nextRunAt > stamp)).toBe(true);
});
