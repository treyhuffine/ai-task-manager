import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {it,expect,vi} from 'vitest';
import {LocalAppsService} from './service';
import {appApprovalPolicy,_resetApprovals,listPendingApprovals} from '@/lib/integrations/approval';
import type {AppInstance} from './state';
import type {Caller} from '@integrations/engine';
import {LIMITS} from '@ri/app-kit/contract';
vi.mock('@/lib/service/maintenance',()=>({beginActivity:()=>()=>{}}));
const policy=appApprovalPolicy({onRequested:async()=>{},onSettled:async()=>{}});
const requests:Caller[]=[];
vi.mock('@/lib/integrations/runtime',()=>({getIntegrationOwnerId:()=> 'fixture-owner',getIntegrationRuntime:async()=>({
 listConnections:async()=>[{id:'fixture-mailbox',ownerId:'fixture-owner',providerId:'google',status:'active'}],
 getToolkits:()=>[{id:'gmail',providerId:'google',actions:[{id:'gmail.get_message'}]}],
 runAction:async(actionId:string,_input:unknown,options:{caller:Caller})=>{
  requests.push(options.caller);
  const decision=await policy.check({actionId,connection:{id:'fixture-mailbox',ownerId:'fixture-owner',providerId:'google',status:'active'} as never,inputDigest:'fixture-input',actionVersion:'1',inputPreview:{synthetic:true},risk:'high',mutating:true,caller:options.caller});
  return decision==='allow'?{ok:true,result:{value:'approved'}}:{ok:false,reason:'approval_required'};
 }
})}));
it('suspends exact SDK broker continuations independently and cancels them outside the app queue',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ri-app-approvals-'));process.env.RI_ROOT=root;process.env.RI_LOCAL_APPS='1';const service=new LocalAppsService();
 try{
  await service.initialize();const apps:AppInstance[]=[];
  for(let index=0;index<2;index++){
   const draft=await service.createDraft('html');const dir=service.draftDir(draft.id),file=path.join(dir,'plugin.json'),manifest=JSON.parse(await fs.readFile(file,'utf8'));
   manifest.extensions['com.ri'].requests.integrations=[{binding:'mailbox',toolkit:'gmail',actions:['gmail.get_message']}];await fs.writeFile(file,JSON.stringify(manifest));
   const source=path.join(dir,'src/actions.ts');let code=await fs.readFile(source,'utf8');
   code=code.replace('actions:[list,add,open,context]',"actions:[list,add,open,context,defineAction({name:'approve_probe',description:'Read a fictional gated connector',input:z.object({}).strict(),output:z.object({value:z.string()}).strict(),audience:['user'],effect:'read',retry:'read_safe',timeoutMs:1000,examples:[{input:{},output:{value:'approved'}}],handler:async(_input,ctx)=>await ctx.capability('gmail.get_message',{messageId:'synthetic'},'mailbox') as {value:string}})]");
   await fs.writeFile(source,code);await service.build(draft.id);const app=await service.activate(draft.id,service.store.read().revision);
   await service.saveGrant({instanceId:app.id,principal:{kind:'owner-ui',id:'owner'},actions:['approve_probe','open_view','list_records'],serviceScopeRef:null,riActions:[],connections:[{binding:'mailbox',connectionId:'fixture-mailbox',actions:['gmail.get_message']}]},service.store.read().revision);apps.push(app);
  }
  const calls=apps.map(app=>service.call(app.id,'approve_probe',{}).then(value=>({value}),error=>({error})));
  await expect.poll(()=>service.approvals.size,{timeout:10000}).toBe(2);
  expect(listPendingApprovals().map(item=>item.localApp?.instanceId).sort()).toEqual(apps.map(app=>app.id).sort());
  const first=[...service.approvals.values()].find(item=>item.instanceId===apps[0].id)!;
  const queued=service.call(apps[0].id,'list_records',{limit:20});
  // Waiting beyond the one-second action deadline keeps the same handler alive.
  await new Promise(resolve=>setTimeout(resolve,1200));expect(service.engine.condition(apps[0].id).condition).toBe('waiting_approval');
  service.decideApproval(first.id,true);expect(await calls[0]).toEqual({value:{value:'approved'}});expect(await queued).toMatchObject({records:[]});
  expect(requests.filter(item=>item.localApp?.instanceId===apps[0].id)).toHaveLength(2);
  expect(new Set(requests.filter(item=>item.localApp?.instanceId===apps[0].id).map(item=>item.localApp?.callId)).size).toBe(1);
  const second=[...service.approvals.values()].find(item=>item.instanceId===apps[1].id)!;service.decideApproval(second.id,false);
  expect(await calls[1]).toMatchObject({error:{code:'interrupted'}});expect(listPendingApprovals()).toEqual([]);
  const expirationCallbacks:(()=>void)[]=[];
  const realTimeout=global.setTimeout;
  const timerSpy=vi.spyOn(global,'setTimeout').mockImplementation(((callback:(...args:unknown[])=>void,delay?:number,...args:unknown[])=>{
   if(delay===LIMITS.approvalMs)expirationCallbacks.push(()=>callback(...args));
   return realTimeout(callback,delay,...args);
  }) as typeof setTimeout);
  const expired=service.call(apps[1].id,'approve_probe',{}).catch(error=>error);
  await expect.poll(()=>service.approvals.size,{timeout:10000}).toBe(1);
  // Fire the production five-minute timers with a controlled test clock.
  expect(expirationCallbacks.length).toBeGreaterThan(0);for(const expire of expirationCallbacks)expire();timerSpy.mockRestore();
  expect(await expired).toMatchObject({code:'interrupted'});expect(service.approvals.size).toBe(0);expect(listPendingApprovals()).toEqual([]);
  const again=service.call(apps[1].id,'approve_probe',{}).catch(error=>error);
  await expect.poll(()=>service.approvals.size,{timeout:10000}).toBe(1);await service.dispose();expect(await again).toMatchObject({code:'interrupted'});expect(service.approvals.size).toBe(0);expect(listPendingApprovals()).toEqual([]);
 }finally{await service.dispose();_resetApprovals();await fs.rm(root,{recursive:true,force:true});delete process.env.RI_ROOT;delete process.env.RI_LOCAL_APPS;}
},180000);
