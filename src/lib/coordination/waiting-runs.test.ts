import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';

let home: TestHome;
beforeEach(async () => { home = await createTestHome(); });
afterEach(async () => { await home.cleanup(); });

function reservation() {
  const workspace = q.createWorkspace({ name: 'Project', cwd: home.root, isGit: false });
  const { execution, session } = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: null });
  const event = q.insertChatEvent({ sessionId: session.id, source: 'user', role: 'user', content: 'Forwarded review.' })!;
  const run = q.reserveOrdinaryCoordinationTurn(session.id, event.id);
  return { execution, session, event, run };
}

it('keeps an unstarted coordination reservation through boot without treating it as a move-held fire or execution mutex', () => {
  const { execution, session, event, run } = reservation();
  const orphan = q.createRun({ harness: 'claude', triggerKind: 'manual', chatSessionId: session.id, executionId: execution.id });
  expect(run).toMatchObject({ status: 'queued', statusReason: q.WAITING_FOR_COORDINATION, startedAt: null });
  expect(q.findActiveRunForExecution(execution.id)).toBeUndefined();
  expect(q.heldFireFor(event.id)).toBeNull();
  expect(q.reapStaleRunningRuns()).toBe(1);
  expect(q.getRun(orphan.id)).toMatchObject({ status: 'failed', errorCode: 'process_restart' });
  expect(q.reserveOrdinaryCoordinationTurn(session.id, event.id)).toEqual(run);
});

it('releases the execution gate on retry, takes it on start, and never resurrects a terminal run', () => {
  const { execution, run } = reservation();
  q.markRunStarted(run.id);
  expect(q.findActiveRunForExecution(execution.id)?.id).toBe(run.id);
  expect(q.markRunWaitingForCoordination(run.id)).toMatchObject({ status: 'queued', statusReason: q.WAITING_FOR_COORDINATION, startedAt: null });
  expect(q.findActiveRunForExecution(execution.id)).toBeUndefined();
  expect(q.reapStaleRunningRuns()).toBe(0);
  q.markRunStarted(run.id);
  expect(q.getRun(run.id)?.statusReason).toBeNull();
  expect(q.reapStaleRunningRuns()).toBe(1);
  const interrupted = q.getRun(run.id);
  expect(interrupted).toMatchObject({ status: 'failed', errorCode: 'process_restart' });
  expect(q.markRunWaitingForCoordination(run.id)).toBeNull();
  expect(q.getRun(run.id)).toEqual(interrupted);
});
