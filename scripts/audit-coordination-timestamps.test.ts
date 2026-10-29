import { afterEach, beforeEach, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { getDb } from '@/lib/db';
import { chatEvents } from '@/lib/db/schema';
import * as q from '@/lib/db/queries';
import { auditCoordinationTimestamps } from './audit-coordination-timestamps';
let home: TestHome;
beforeEach(async()=>{home=await createTestHome();});
afterEach(async()=>{await home.cleanup();});
it('reports only identifiable coordination timestamps, without repairing or touching unrelated history',()=>{
  const source=q.createChatSession({harness:'claude',type:'content'});
  const target=q.createChatSession({harness:'claude',type:'content'});
  function send(id:string,status:'queued'|'awaiting_approval') {
    return q.createInitiatingAgentDelivery({id,source,sourceRunId:null,address:`session:${target.id}`,targetSessionId:target.id,requestKey:id,parentRequestId:null,kind:'message',content:'Review.',options:null,eventId:`input-${id}`,prompt:'Review.',status});
  }
  send('approval','awaiting_approval');
  q.persistAgentDelivery(send('message','queued').id);
  const coordination=[...q.listChatEvents(source.id),...q.listChatEvents(target.id)];
  const ordinary=q.insertChatEvent({sessionId:source.id,role:'user',source:'user',content:'An unrelated human message.'})!;
  const before='2026-10-29 15:05:17';
  getDb().update(chatEvents).set({createdAt:before}).where(inArray(chatEvents.id,[...coordination.map(row=>row.id),ordinary.id])).run();
  const report=auditCoordinationTimestamps(home.root);
  expect(report.total).toBe(3);
  expect(report.events.map(row=>row.id).sort()).toEqual(coordination.map(row=>row.id).sort());
  for(const event of report.events) {
    expect(event).toMatchObject({before,after:'2026-10-29T15:05:17.000Z'});
    expect(q.getChatEventById(event.id)?.createdAt).toBe(before);
  }
  expect(q.getChatEventById(ordinary.id)?.createdAt).toBe(before);
  expect(auditCoordinationTimestamps(home.root)).toEqual(report);
});
