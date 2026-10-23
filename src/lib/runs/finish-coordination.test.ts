import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import * as notifications from '@/lib/notifications/emit';
import { finishRun } from './finish';

let home: TestHome;
beforeEach(async () => { home = await createTestHome(); });
afterEach(async () => { vi.restoreAllMocks(); await home.cleanup(); });
function fixture() {
  const workspace = q.createWorkspace({name:'Scheduled work',cwd:home.root,isGit:false});
  const {session} = q.createExecutionWithChat({workspaceId:workspace.id,harness:'claude',label:'Scheduled send'});
  const trigger = q.createTrigger({name:'Scheduled send',workspaceId:workspace.id,targetKind:'workspace',harness:'claude',prompt:'Send this message.',kind:'at',runAt:new Date().toISOString()});
  const run = q.createRun({triggerId:trigger.id,workspaceId:workspace.id,executionId:session.executionId,chatSessionId:session.id,harness:'claude',triggerKind:'at',status:'running'});
  const target = q.createChatSession({harness:'claude',type:'content'});
  q.createInitiatingAgentDelivery({id:'pending-send',source:session,sourceRunId:run.id,address:`session:${target.id}`,targetSessionId:target.id,requestKey:'pending-send',parentRequestId:null,kind:'message',content:'Requested message.',options:null,eventId:'pending-input',prompt:'Requested message.',status:'awaiting_approval'});
  return {session,trigger,run,target};
}

it('reports unresolved scheduled send approval as failure and asks for attention exactly once', () => {
  const {session,trigger,run} = fixture();
  const attention = vi.spyOn(notifications,'queueNeedsInput');
  q.insertChatEvent({sessionId:session.id,role:'user',source:'user',content:'Send this message.'});
  q.insertChatEvent({sessionId:session.id,role:'assistant',source:'agent',content:'The message was sent.'});
  finishRun(run.id,{ok:true});
  expect(q.getRun(run.id)).toMatchObject({status:'failed',errorCode:'coordination_approval_required',errorMessage:expect.stringContaining('could not complete')});
  expect(q.getTrigger(trigger.id)?.lastRunStatus).toBe('failed');
  expect(q.getChatSession(session.id)?.lastOutcomeEventAt).toBeTruthy();
  expect(attention).toHaveBeenCalledOnce();
  expect(attention).toHaveBeenCalledWith(expect.objectContaining({sessionId:session.id,title:'Scheduled job needs approval'}));
  expect(notifications.runTerminalNotification(run.id)?.event.body).toContain('waiting for your approval');
  expect(q.getAgentDelivery('pending-send')?.status).toBe('awaiting_approval');
  finishRun(run.id,{ok:true});
  expect(attention).toHaveBeenCalledOnce();
});

it('keeps a more specific provider failure authoritative', () => {
  const {run} = fixture();
  const attention = vi.spyOn(notifications,'queueNeedsInput');
  finishRun(run.id,{ok:false,errorCode:'provider_error',errorMessage:'Provider disconnected.'});
  expect(q.getRun(run.id)).toMatchObject({status:'failed',errorCode:'provider_error'});
  expect(attention).not.toHaveBeenCalled();
});

it('does not turn a human Stop into another approval request', () => {
  const {run} = fixture();
  const attention = vi.spyOn(notifications,'queueNeedsInput');
  finishRun(run.id,{ok:true,stopped:true});
  expect(q.getRun(run.id)?.status).toBe('completed');
  expect(attention).not.toHaveBeenCalled();
});

it('leaves an authorized queued send as delivery state, rather than claiming it needs approval', () => {
  const {run} = fixture();
  q.decideAgentDelivery('pending-send','allow');
  const attention = vi.spyOn(notifications,'queueNeedsInput');
  finishRun(run.id,{ok:true});
  expect(q.getRun(run.id)?.status).toBe('completed');
  expect(q.getAgentDelivery('pending-send')?.status).toBe('queued');
  expect(attention).not.toHaveBeenCalled();
});

it('uses a subscribed terminal notification without duplicating it as a needs-input notification', () => {
  const {run} = fixture();
  vi.spyOn(notifications,'queueRunTerminal').mockReturnValue({dedupeKey:`execution.finished:${run.id}`,channelIds:[]});
  const attention = vi.spyOn(notifications,'queueNeedsInput');
  finishRun(run.id,{ok:true});
  expect(q.getRun(run.id)?.errorCode).toBe('coordination_approval_required');
  expect(attention).not.toHaveBeenCalled();
});
