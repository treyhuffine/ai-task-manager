import {expect,it} from 'vitest';
import {callRiCapability} from './ri-capabilities';
import * as q from '@/lib/db/queries';
import {randomUUID} from 'node:crypto';
import type {InvocationContext} from '@ri/app-kit/contract';

it('persists create receipts in the entity identity and separates app, actor and invocation retries',async()=>{
  const instance=randomUUID();
  const context:InvocationContext={id:randomUUID(),principal:{kind:'job',id:randomUUID()},audience:'schedule',grantRevision:1,deadline:Date.now()+30000,packageDigest:'a'.repeat(64)};
  const call={callId:randomUUID(),name:'create_task',input:{title:'Synthetic app task',body:'A task from the disposable fixture'}};
  const signal=new AbortController().signal;
  const first=await callRiCapability(instance,context,call,signal) as {id:string};
  const retried=await callRiCapability(instance,context,{...call,callId:randomUUID()},signal) as {id:string};
  expect(retried.id).toBe(first.id);
  expect(q.getTask(first.id)?.body).toBe(call.input.body);
  const distinct=await callRiCapability(instance,{...context,principal:{kind:'job',id:randomUUID()}},call,signal) as {id:string};
  expect(distinct.id).not.toBe(first.id);
  const second=await callRiCapability(instance,{...context,id:randomUUID()},call,signal) as {id:string};
  expect(second.id).not.toBe(first.id);
  expect(q.createTask({title:'Ordinary task'}).id).not.toBe(first.id);
  const note={callId:randomUUID(),name:'create_note',input:{title:'Fixture note',body:'Fixture note body'}};
  const n=await callRiCapability(instance,context,note,signal) as {id:string};
  expect(await callRiCapability(instance,context,{...note,callId:randomUUID()},signal)).toMatchObject({id:n.id});
  expect(await callRiCapability(instance,context,{callId:randomUUID(),name:'get_note',input:{id:n.id}},signal)).toMatchObject({body:'Fixture note body'});
  await expect(callRiCapability(instance,context,{callId:randomUUID(),name:'list_tasks',input:{limit:101}},signal)).rejects.toThrow();
  const aborted=new AbortController();aborted.abort();
  await expect(callRiCapability(instance,context,call,aborted.signal)).rejects.toMatchObject({code:'interrupted'});
});
