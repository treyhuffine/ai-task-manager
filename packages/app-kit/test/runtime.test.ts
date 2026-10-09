import { describe,it,expect,afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppEngine,NativeNodeDriver,inspectNode,assertTarget } from '@ri/app-kit/runtime';
import { fixtureHost } from '@ri/app-kit/testing';
import { nodeFixture } from './helpers';
const dirs:string[]=[];const engines:AppEngine[]=[];
afterEach(async()=>{await Promise.all(engines.splice(0).map(engine=>engine.dispose()));for(const dir of dirs.splice(0))fs.rmSync(dir,{recursive:true,force:true});delete process.env.RI_SECRET_PROBE;});
async function fixture(options:Parameters<typeof nodeFixture>[1]={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ri-app-runtime-'));dirs.push(root);const artifact=await nodeFixture(path.join(root,'package'),options);const host=fixtureHost(process.execPath,path.join(root,'records'));engines.push(host.engine);const instance=host.install(artifact.packageDir,randomUUID());return {...host,instance};}
const principal={kind:'fixture' as const,id:'test'};
describe('owned runtime',()=>{
  it('reads bounded service health without starting a stopped service and withholds stale results',async()=>{
    const f=await fixture();
    const summary={ready:true,worker:{started:true,running:false,lastStartedAt:null,lastFinishedAt:null},pendingSetup:true,jobs:{states:{idle:1},hasMore:false,nextRunAt:null}};
    let response:unknown=summary, release:((value:unknown)=>void)|undefined;
    const transport={generation:randomUUID(),pid:process.pid,request:async()=>response,onCapability(){},onExit(){},async stop(){}};
    const driver={profile:'trusted-native' as const,async prepare(){},async start(){return transport;},async stop(){},async dispose(){}};
    const engine=new AppEngine(f.engine.host,driver);engines.push(engine);
    f.instance.manifest.extensions['com.ri'].runtime.protocol='mcp-http-v1';
    expect(await engine.serviceStatus(f.instance.instanceId)).toBeNull();
    await engine.start(f.instance);
    expect(await engine.serviceStatus(f.instance.instanceId)).toEqual(summary);
    response={...summary,privateRecords:['secret']};
    await expect(engine.serviceStatus(f.instance.instanceId)).rejects.toMatchObject({code:'invalid_input'});
    response={...summary,jobs:{...summary.jobs,states:{idle:101}}};
    await expect(engine.serviceStatus(f.instance.instanceId)).rejects.toMatchObject({code:'invalid_input'});
    response=new Promise(resolve=>{release=resolve;});
    const pending=engine.serviceStatus(f.instance.instanceId);
    await engine.stop(f.instance.instanceId);release!(summary);
    await expect(pending).rejects.toMatchObject({code:'revoked'});
  });
  it('checks the actual executable target before package code',async()=>{
    const actual=await inspectNode(process.execPath);expect(actual.nodeVersion).toBe(process.versions.node);expect(actual.nodeAbi).toBe(process.versions.modules);
    expect(()=>assertTarget({...actual,nodeAbi:'0'},actual)).toThrow(/does not support/);
  });
  it('keeps app data across restarts, deduplicates writes, and omits parent secrets',async()=>{
    const f=await fixture();process.env.RI_SECRET_PROBE='private-parent-value';
    const invocation=randomUUID();expect(await f.engine.invoke(f.instance,'increment',{amount:3},principal,1,invocation)).toEqual({value:3});
    expect(await f.engine.invoke(f.instance,'increment',{amount:3},principal,1,invocation)).toEqual({value:3});
    await expect(f.engine.invoke(f.instance,'increment',{amount:4},principal,1,invocation)).rejects.toThrow(/another operation/);
    expect(JSON.parse(fs.readFileSync(path.join(f.instance.dataDir,'environment.json'),'utf8'))).toEqual({token:null,options:null});
    await f.engine.stop(f.instance.instanceId);
    const result=await f.engine.invoke(f.instance,'open_view',{path:'/',query:{}},principal,1) as {data:{value:number}};expect(result.data.value).toBe(3);
  });
  it('rechecks revocation before releasing an in-flight protected result',async()=>{
    const f=await fixture({delay:150});let allowed=true;
    const engine=new AppEngine({version:1,authorize(){if(!allowed)throw new Error('revoked');},async capability(){return {};},event(){}},new NativeNodeDriver(process.execPath));engines.push(engine);
    const call=engine.invoke(f.instance,'increment',{amount:1},principal,1);
    await new Promise(resolve=>setTimeout(resolve,100));allowed=false;
    await expect(call).rejects.toThrow(/revoked/);
  });
  it('times out a synchronous hang and stops its stubborn descendant',async()=>{
    const f=await fixture({hang:true,descendant:true});
    await expect(f.engine.invoke(f.instance,'increment',{amount:1},principal,1)).rejects.toMatchObject({code:'timeout'});
    const pid=Number(fs.readFileSync(path.join(f.instance.dataDir,'descendant.pid'),'utf8'));
    await f.engine.stop(f.instance.instanceId);
    await expect.poll(()=>{try{process.kill(pid,0);return true;}catch{return false;}},{timeout:2000}).toBe(false);
  });
  it('rejects queue overload before it can accumulate unbounded work',async()=>{
    const f=await fixture({delay:2000});
    const calls=Array.from({length:34},()=>f.engine.invoke(f.instance,'increment',{amount:1},principal,1).catch(error=>error.code));
    await expect.poll(()=>f.engine.condition(f.instance.instanceId).queued).toBe(32);
    expect(await calls.at(-1)).toBe('busy');
    await f.engine.stop(f.instance.instanceId);
    const results=await Promise.all(calls);expect(results.filter(value=>value==='busy').length).toBeGreaterThan(0);expect(results.every(value=>value==='busy'||value==='interrupted')).toBe(true);
  });
  it('contains failed readiness and prevents an unbounded restart loop',async()=>{
    const f=await fixture({failedReady:true});
    for(let attempt=0;attempt<3;attempt++)await expect(f.engine.invoke(f.instance,'increment',{amount:1},principal,1)).rejects.toMatchObject({code:'app_failed'});
    await expect(f.engine.invoke(f.instance,'increment',{amount:1},principal,1)).rejects.toThrow(/failed to start repeatedly/);
    expect(f.engine.condition(f.instance.instanceId).condition).toBe('failed');
  });
  it('stopping cancels queued calls instead of starting them again',async()=>{
    const f=await fixture({delay:2000});
    const one=f.engine.invoke(f.instance,'increment',{amount:1},principal,1).catch(error=>error.code);
    const two=f.engine.invoke(f.instance,'increment',{amount:1},principal,1).catch(error=>error.code);
    await new Promise(resolve=>setTimeout(resolve,200));await f.engine.stop(f.instance.instanceId);
    expect(await one).toBe('interrupted');expect(await two).toBe('interrupted');expect(f.engine.condition(f.instance.instanceId).condition).toBe('stopped');
  });
});
