import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { toChatEventDTO } from '@/lib/api/dto/chat-event';
import { filterRenderable } from '@/components/chat-ui/chat-transcript';
import { CHAT_MESSAGE_SENT } from '@/lib/sessions/chat-message';

let home: TestHome;
const now = '2026-10-29T15:05:17.123Z';
beforeEach(async () => {
  vi.useFakeTimers({toFake:['Date']});
  vi.setSystemTime(new Date(now));
  home = await createTestHome();
});
afterEach(async () => { vi.useRealTimers(); await home.cleanup(); });
function chats() {
  const source = q.createChatSession({harness:'claude',type:'content'});
  const target = q.createChatSession({harness:'claude',type:'content'});
  return {source,target};
}
function harnessEvents(sessionId: string) {
  for (let i=0;i<80;i++) q.insertChatEvent({sessionId,role:'assistant',source:'agent',content:`Earlier harness event ${i}`,createdAt:new Date(Date.parse('2026-10-29T15:04:00.000Z')+i*20).toISOString()});
}
it('keeps a newly proposed approval at the end of the latest rendered page after same-day ISO harness events', () => {
  const {source,target}=chats(); harnessEvents(source.id);
  q.createInitiatingAgentDelivery({id:'proposal',source,sourceRunId:null,address:`session:${target.id}`,targetSessionId:target.id,requestKey:'request',parentRequestId:null,kind:'message',content:'Review the change.',options:null,eventId:'proposal-input',prompt:'Review the change.',status:'awaiting_approval'});
  const page = q.listChatEvents(source.id,{limit:25});
  expect(page).toHaveLength(25);
  expect(page.at(-1)).toMatchObject({createdAt:now,content:'coordination_proposed'});
  const visible=filterRenderable(page.map(toChatEventDTO));
  expect(visible.at(-1)?.content).toBe('coordination_proposed');
});
it('orders delivered agent messages and their sent receipt after harness events, without changing them on retry', () => {
  const {source,target}=chats(); harnessEvents(source.id); harnessEvents(target.id);
  const delivery=q.createInitiatingAgentDelivery({id:'send',source,sourceRunId:null,address:`session:${target.id}`,targetSessionId:target.id,requestKey:'send',parentRequestId:null,kind:'message',content:'Please review.',options:null,eventId:'agent-message',prompt:'[Ri agent message] Please review.',status:'queued'});
  q.persistAgentDelivery(delivery.id);
  expect(q.listChatEvents(target.id,{limit:1})[0]).toMatchObject({id:'agent-message',createdAt:now});
  expect(q.listChatEvents(source.id,{limit:1})[0]).toMatchObject({content:CHAT_MESSAGE_SENT,createdAt:now});
  vi.setSystemTime(new Date('2026-10-29T15:06:00.000Z'));
  q.persistAgentDelivery(delivery.id);
  expect(q.getChatEventById('agent-message')?.createdAt).toBe(now);
});
it('timestamps human forwards, failed-send audits and preserved system context with ISO defaults', () => {
  const {source,target}=chats(); harnessEvents(source.id); harnessEvents(target.id);
  const forward=q.createAgentDelivery({id:'forward',kind:'message',senderKind:'human',sourceSessionId:source.id,targetSessionId:target.id,targetAddress:`session:${target.id}`,eventId:'forward-message',payload:{version:1,content:'Full forwarded review',prompt:'Full forwarded review',attachments:[]},status:'queued'});
  q.persistAgentDelivery(forward.id);
  expect(q.getChatEventById(forward.eventId)?.createdAt).toBe(now);
  const context=q.preserveSystemContext(target.id,'decision','The user wants this held.');
  expect(q.getChatEventById(context.eventId)?.createdAt).toBe(now);
  const failed=q.createAgentDelivery({id:'failed',kind:'message',senderKind:'human',sourceSessionId:source.id,targetSessionId:target.id,targetAddress:`session:${target.id}`,eventId:'failed-input',payload:{version:1,content:'Review',prompt:'Review',attachments:[]},status:'queued'});
  q.failAgentDelivery(failed.id,'Unavailable.');
  expect(q.listChatEvents(source.id).find(event=>event.content==='coordination_send_failed')?.createdAt).toBe(now);
});
