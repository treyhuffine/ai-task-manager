import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createTestHome,type TestHome} from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import {coordinationRouter} from './router';
import {SESSION_CREDENTIAL_HEADER,sessionCredential} from '@/lib/orchestrator/session-credential';
vi.mock('./service',async original=>({...await original<object>(),drainAgentCoordination:async()=>{}}));
let home:TestHome;
beforeEach(async()=>{home=await createTestHome();});
afterEach(async()=>{await home.cleanup();});
function caller(scope:'viewer'|'session'|'worker'='viewer',headers?:HeadersInit) {
  return coordinationRouter.createCaller({request:new Request('http://localhost/api/trpc',{headers}),key:{apiKeyId:'fixture',scope,location:'home',workerDeviceId:null,sessionChatId:null}});
}
it.each(['session','worker'] as const)('keeps policy, Hold, decisions and human forwarding unavailable to %s callers',async scope=>{
  const api=caller(scope);
  await expect(api.policy({scope:'global',id:'1',policy:'allow'})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(api.hold({sessionId:'chat',held:true})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(api.decide({deliveryId:'send',decision:'always'})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(api.forward({sendId:'key',sourceEventId:'message',directions:'',target:'chat'})).rejects.toMatchObject({code:'FORBIDDEN'});
});
it('rejects signed agents carrying a viewer key before any human control changes state',async()=>{
  const source=q.createChatSession({harness:'claude',type:'content'});
  const target=q.createChatSession({harness:'claude',type:'content'});
  const event=q.insertChatEvent({sessionId:source.id,source:'agent',role:'assistant',content:'Review this material.'})!;
  const pending=q.createInitiatingAgentDelivery({id:'approval',source,sourceRunId:null,address:`session:${target.id}`,targetSessionId:target.id,requestKey:'approval',parentRequestId:null,kind:'message',content:'Please inspect.',options:null,eventId:'approval-event',prompt:'Please inspect.',status:'awaiting_approval'});
  q.setAgentCoordinationHold(source.id,true);
  const before={policy:q.agentCoordinationPolicy(source.id),delivery:q.getAgentDelivery(pending.id),sourceEvents:q.listChatEvents(source.id),targetEvents:q.listChatEvents(target.id)};
  const api=caller('viewer',{[SESSION_CREDENTIAL_HEADER]:sessionCredential(source.id,home.token)!});
  await expect(api.policy({scope:'global',id:'1',policy:'allow'})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(api.hold({sessionId:source.id,held:false})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(api.decide({deliveryId:pending.id,decision:'always'})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(api.forward({sendId:'signed-forward',sourceEventId:event.id,directions:'Inspect this.',target:target.id})).rejects.toMatchObject({code:'FORBIDDEN'});
  expect({policy:q.agentCoordinationPolicy(source.id),delivery:q.getAgentDelivery(pending.id),sourceEvents:q.listChatEvents(source.id),targetEvents:q.listChatEvents(target.id)}).toEqual(before);
  expect((await api.state({sessionId:source.id})).heldAt).toBe(before.policy.heldAt);
  await caller().decide({deliveryId:pending.id,decision:'allow'});
  expect(q.getAgentDelivery(pending.id)?.status).toBe('queued');
});
it('saves viewer preferences and Hold with visible policy provenance',async()=>{
  const session=q.createChatSession({harness:'claude',type:'content'});
  const api=caller();
  await api.policy({scope:'global',id:'1',policy:'allow'});
  expect(await api.state({sessionId:session.id})).toMatchObject({policy:'allow',source:'global'});
  await api.policy({scope:'chat',id:session.id,policy:'ask'});
  await api.hold({sessionId:session.id,held:true});
  expect(await api.state({sessionId:session.id})).toMatchObject({policy:'ask',source:'chat',heldAt:expect.any(String)});
  await expect(api.policy({scope:'chat',id:'missing',policy:'allow'})).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('sorts the picker by recent activity and applies search and agent filters without reading transcripts',async()=>{
  const workspace=q.createWorkspace({name:'Research',cwd:home.root,isGit:false});
  const older=q.createChatSession({harness:'claude',type:'content',workspaceId:workspace.id,label:'Older review'});
  const newer=q.createChatSession({harness:'claude',type:'content',workspaceId:workspace.id,label:'Newest review'});
  q.updateChatSession(older.id,{lastActivityAt:'2026-01-01T00:00:00Z'});
  q.updateChatSession(newer.id,{lastActivityAt:'2026-10-22T00:00:00Z'});
  const api=caller();
  expect((await api.targets({workspaceId:workspace.id,search:'review'})).map(chat=>chat.id)).toEqual([newer.id,older.id]);
  expect((await api.targets({workspaceId:workspace.id,search:'Newest'})).map(chat=>chat.id)).toEqual([newer.id]);
  expect(await api.message({sessionId:older.id,eventId:q.insertChatEvent({sessionId:newer.id,source:'agent',role:'assistant',content:'Private to the other chat'})!.id})).toBeNull();
});
it('preserves full long forwarding text through an attachment and reuses one immutable delivery after a changed source',async()=>{
  const source=q.createChatSession({harness:'claude',type:'content'});
  const target=q.createChatSession({harness:'claude',type:'content'});
  const text='Full selected content. '.repeat(5000);
  const event=q.insertChatEvent({sessionId:source.id,source:'agent',role:'assistant',content:text})!;
  const api=caller();
  const input={sendId:'forward-key',sourceEventId:event.id,directions:'  Review everything.  ',target:target.id};
  const first=await api.forward(input);const second=await api.forward(input);
  expect(second.id).toBe(first.id);
  expect(first).toMatchObject({senderKind:'human',requestId:null,payload:{content:text,directions:'Review everything.'}});
  expect(first.payload.attachments).toHaveLength(1);
  expect(first.payload.prompt).toContain(`[[file:${first.payload.attachments[0].fileName}]]`);
  const fs=await import('node:fs/promises');
  const {attachmentPath}=await import('@/lib/attachments/save');
  expect(await fs.readFile(attachmentPath(first.payload.attachments[0].fileName),'utf8')).toBe(text);
  await expect(api.forward({...input,directions:'Changed intent.'})).rejects.toMatchObject({code:'CONFLICT'});
});
it('freezes new-chat model, variant, effort and provider speed in a human forward',async()=>{
  const source=q.createChatSession({harness:'claude',type:'content'});
  const workspace=q.createWorkspace({name:'Project',cwd:home.root,isGit:false});
  const event=q.insertChatEvent({sessionId:source.id,source:'agent',role:'assistant',content:'Review this.'})!;
  const input={sendId:'model-forward',sourceEventId:event.id,directions:'',launch:{workspaceId:workspace.id,provider:'claude' as const,model:'sonnet',modelVariant:null,effort:'high' as const,serviceTier:'fast'}};
  const first=await caller().forward(input);
  expect(first.payload.launch).toEqual(input.launch);
  expect((await caller().forward(input)).id).toBe(first.id);
  await expect(caller().forward({...input,launch:{...input.launch,serviceTier:'default'}})).rejects.toMatchObject({code:'CONFLICT'});
});
