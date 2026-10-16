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

it('creates one dated Ri task per app operation and validates the due date',async()=>{
  const instance=randomUUID(),operationId=randomUUID(),signal=new AbortController().signal;
  const context=(id=randomUUID()):InvocationContext=>({id,principal:{kind:'owner-ui',id:'owner'},audience:'user',grantRevision:1,deadline:Date.now()+30000,packageDigest:'a'.repeat(64)});
  const call=(input:Record<string,unknown>)=>({callId:randomUUID(),name:'create_task',input});
  const first=await callRiCapability(instance,context(),call({title:'Confirm airport transfer',dueAt:'2026-11-08',operationId}),signal) as {id:string;hardDeadline:string|null};
  expect(first.hardDeadline).toBe('2026-11-08');
  // A second click or a retry under a new invocation still returns the first task.
  const again=await callRiCapability(instance,context(),call({title:'Confirm airport transfer',dueAt:'2026-11-08',operationId}),signal) as {id:string};
  expect(again.id).toBe(first.id);
  const timed=await callRiCapability(instance,context(),call({title:'Prepare questions',dueAt:'2026-10-16T09:00:00-06:00',operationId:randomUUID()}),signal) as {hardDeadline:string};
  expect(timed.hardDeadline).toBe('2026-10-16T09:00:00-06:00');
  await expect(callRiCapability(instance,context(),call({title:'Bad date',dueAt:'2026-02-30'}),signal)).rejects.toThrow();
  await expect(callRiCapability(instance,context(),call({title:'Bad date',dueAt:'tomorrow'}),signal)).rejects.toThrow();
  await expect(callRiCapability(instance,context(),call({title:'Bad op',operationId:'not-a-uuid'}),signal)).rejects.toThrow();
});

it('extracts bounded text from chosen files and refuses unreadable ones',async()=>{
  const instance=randomUUID(),signal=new AbortController().signal;
  const context:InvocationContext={id:randomUUID(),principal:{kind:'owner-ui',id:'owner'},audience:'user',grantRevision:1,deadline:Date.now()+30000,packageDigest:'a'.repeat(64)};
  const text=await callRiCapability(instance,context,{callId:randomUUID(),name:'extract_text',input:{fileName:'confirmation.txt',mimeType:'text/plain',base64:Buffer.from('Booking reference RH-4821\u0000\n\n\n\n\nCheck-in Nov 10').toString('base64')}},signal);
  expect(text).toEqual({text:'Booking reference RH-4821\n\n\nCheck-in Nov 10',truncated:false,characters:43});
  await expect(callRiCapability(instance,context,{callId:randomUUID(),name:'extract_text',input:{fileName:'scan.pdf',mimeType:'application/pdf',base64:Buffer.from('not a pdf').toString('base64')}},signal)).rejects.toMatchObject({code:'invalid_input'});
  await expect(callRiCapability(instance,context,{callId:randomUUID(),name:'extract_text',input:{fileName:'x.exe',mimeType:'application/x-msdownload',base64:''}},signal)).rejects.toThrow();
});

it('reads text from a real PDF through Ri\'s parser',async()=>{
  const context:InvocationContext={id:randomUUID(),principal:{kind:'owner-ui',id:'owner'},audience:'user',grantRevision:1,deadline:Date.now()+30000,packageDigest:'a'.repeat(64)};
  const result=await callRiCapability(randomUUID(),context,{callId:randomUUID(),name:'extract_text',input:{fileName:'confirmation.pdf',mimeType:'application/pdf',base64:'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA2NyA+PgpzdHJlYW0KQlQgL0YxIDE4IFRmIDcyIDcyMCBUZCAoUml2ZXJzaWRlIEhvdXNlIGNvbmZpcm1hdGlvbiBSSC00ODIxKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDM1OCAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQyOAolJUVPRgo='}},new AbortController().signal) as {text:string};
  expect(result.text).toContain('Riverside House confirmation RH-4821');
},20000);
