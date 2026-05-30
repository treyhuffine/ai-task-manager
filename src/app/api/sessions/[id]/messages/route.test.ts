import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Verifies the messages route's pre-flight gating on retry.
 *
 * Bug fix #1 (retry race): clients re-POST the same `body.id` after a
 * transient failure. Before the fix, my new execution-mutex / budget
 * pre-flight returned 409 on the retry if a scheduled run had started
 * in the meantime — even though the original send was already in
 * flight. The user saw an error while the agent was still working.
 *
 * The route now peeks `getChatEventById(body.id)` first; when the row
 * exists, it skips the pre-flight and falls through to the existing
 * orphan-healing path. This test covers both branches:
 *
 *  1. Fresh send + execution blocker → 409 (pre-flight DOES gate)
 *  2. Retry (same body.id existed) + execution blocker → 201 (skipped)
 *  3. Fresh send + no blocker → 201 (happy path, pre-flight passes)
 */

const getChatEventById = vi.fn();
const getChatSessionWithExecution = vi.fn();
const findActiveRunForExecution = vi.fn();
const insertChatEvent = vi.fn();
const materializeEventRefs = vi.fn();
const getAgent = vi.fn();
const budgetGate = vi.fn(() => 'ok');
const dispatch = vi.fn(async () => {});
const healthCheckSession = vi.fn(async () => {});
const expandMarkers = vi.fn(async (s: string) => s);
const expandEntityMarkers = vi.fn((s: string) => s);
const deriveAndSetSessionLabel = vi.fn(async () => {});

// Mocks reference the top-level spy fns via untyped pass-through. The
// `as never` casts paper over `vi.fn()`'s very-precise default
// signature — these factories just need to delegate.
vi.mock('@/lib/db/queries', () => ({
  getChatEventById: (id: string) => (getChatEventById as unknown as (id: string) => unknown)(id),
  getChatSessionWithExecution: (id: string) =>
    (getChatSessionWithExecution as unknown as (id: string) => unknown)(id),
  findActiveRunForExecution: (id: string) =>
    (findActiveRunForExecution as unknown as (id: string) => unknown)(id),
  insertChatEvent: (input: unknown) =>
    (insertChatEvent as unknown as (input: unknown) => unknown)(input),
  materializeEventRefs: (a: string, b: string, c: string) =>
    (materializeEventRefs as unknown as (...args: unknown[]) => unknown)(a, b, c),
  getAgent: (id: string) => (getAgent as unknown as (id: string) => unknown)(id),
}));

vi.mock('@/lib/runs/budget', () => ({
  budgetGate: () => (budgetGate as unknown as () => string)(),
}));

vi.mock('@/lib/executor/adapter', () => ({
  dispatch: async (id: string, content: string) =>
    (dispatch as unknown as (id: string, content: string) => Promise<void>)(id, content),
}));

vi.mock('@/lib/executor/health', () => ({
  healthCheckSession: async (id: string, opts?: unknown) =>
    (healthCheckSession as unknown as (id: string, opts?: unknown) => Promise<void>)(id, opts),
}));

vi.mock('@/lib/attachments/expand-markers', () => ({
  expandMarkers: async (s: string, attachments?: unknown) =>
    (expandMarkers as unknown as (s: string, attachments?: unknown) => Promise<string>)(s, attachments),
}));

vi.mock('@/lib/entity-refs/expand-markers', () => ({
  expandEntityMarkers: (s: string, sessionId: string) =>
    (expandEntityMarkers as unknown as (s: string, sessionId: string) => string)(s, sessionId),
}));

vi.mock('@/lib/sessions/derive-label', () => ({
  deriveAndSetSessionLabel: async (a: string, b: string, c: string) =>
    (deriveAndSetSessionLabel as unknown as (...args: unknown[]) => Promise<void>)(a, b, c),
}));

import { POST } from './route';

const SESSION_ID = 'sess-1';
const EXECUTION_ID = 'exec-1';
const CLIENT_ID = '019e6754-fbfb-7ec3-9d2e-1234567890ab';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/sessions/sess-1/messages', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as unknown as NextRequest;
}

function makeParams() {
  return { params: Promise.resolve({ id: SESSION_ID }) };
}

beforeEach(() => {
  getChatEventById.mockReset();
  getChatSessionWithExecution.mockReset();
  findActiveRunForExecution.mockReset();
  insertChatEvent.mockReset();
  materializeEventRefs.mockReset();
  getAgent.mockReset();
  budgetGate.mockReset().mockReturnValue('ok');
  dispatch.mockReset().mockResolvedValue(undefined);
  healthCheckSession.mockReset().mockResolvedValue(undefined);
  expandMarkers.mockReset().mockImplementation(async (s: string) => s);
  expandEntityMarkers.mockReset().mockImplementation((s: string) => s);
  deriveAndSetSessionLabel.mockReset().mockResolvedValue(undefined);

  getChatSessionWithExecution.mockReturnValue({
    id: SESSION_ID,
    status: 'active',
    executionId: EXECUTION_ID,
    agentId: 'agent-1',
    label: 'Test',
    workspaceId: 'ws-1',
    takeoverStartedAt: null,
  });
  getAgent.mockReturnValue({ id: 'agent-1', harness: 'claude_code' });
});

describe('POST /api/sessions/[id]/messages — pre-flight retry handling', () => {
  it('fresh send + execution blocker → 409 (pre-flight rejects)', async () => {
    // No prior chat_event for this body.id.
    getChatEventById.mockReturnValue(undefined);
    // Scheduled run already in flight against this execution.
    findActiveRunForExecution.mockReturnValue({ id: 'run-x', status: 'running' });

    const res = await POST(
      makeRequest({ content: 'hello', id: CLIENT_ID }),
      makeParams(),
    );
    expect(res.status).toBe(409);
    const json = await (res as Response).json();
    expect(json.error).toBe('execution_busy');
    // The route should NOT have proceeded to persist on a 409.
    expect(insertChatEvent).not.toHaveBeenCalled();
  });

  it('retry of an existing send + execution blocker → 201 (pre-flight bypassed)', async () => {
    // body.id matches a previously-persisted chat_event row — this is
    // a retry. Pre-flight should be skipped even though a scheduled
    // run is now in flight; the original send is already running and
    // the orphan-healing path takes over.
    getChatEventById.mockReturnValue({
      id: CLIENT_ID,
      sessionId: SESSION_ID,
      role: 'user',
      source: 'user',
      content: 'hello',
    });
    findActiveRunForExecution.mockReturnValue({ id: 'run-x', status: 'running' });
    // PK conflict → insertChatEvent returns null (existing row).
    insertChatEvent.mockReturnValue(null);

    const res = await POST(
      makeRequest({ content: 'hello', id: CLIENT_ID }),
      makeParams(),
    );
    expect(res.status).toBe(201);
    // healthCheckSession should be called with redispatchOrphans: true
    // (the route's existing retry path).
    expect(healthCheckSession).toHaveBeenCalledWith(SESSION_ID, { redispatchOrphans: true });
    // executor.dispatch should NOT be called directly on retry —
    // health's orphan logic owns the redispatch decision.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('fresh send + no blocker → 201 (happy path)', async () => {
    getChatEventById.mockReturnValue(undefined);
    findActiveRunForExecution.mockReturnValue(undefined);
    insertChatEvent.mockReturnValue({
      id: CLIENT_ID,
      sessionId: SESSION_ID,
      role: 'user',
      source: 'user',
      content: 'hello',
    });

    const res = await POST(
      makeRequest({ content: 'hello', id: CLIENT_ID }),
      makeParams(),
    );
    expect(res.status).toBe(201);
    expect(insertChatEvent).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(SESSION_ID, 'hello');
  });

  it('fresh send + budget block → 402', async () => {
    getChatEventById.mockReturnValue(undefined);
    findActiveRunForExecution.mockReturnValue(undefined);
    budgetGate.mockReturnValue('block');

    const res = await POST(
      makeRequest({ content: 'hello', id: CLIENT_ID }),
      makeParams(),
    );
    expect(res.status).toBe(402);
    const json = await (res as Response).json();
    expect(json.error).toBe('budget_exceeded');
    expect(insertChatEvent).not.toHaveBeenCalled();
  });

  it('retry + budget block → 201 (budget pre-flight bypassed on retry)', async () => {
    getChatEventById.mockReturnValue({ id: CLIENT_ID, sessionId: SESSION_ID });
    budgetGate.mockReturnValue('block');
    insertChatEvent.mockReturnValue(null);

    const res = await POST(
      makeRequest({ content: 'hello', id: CLIENT_ID }),
      makeParams(),
    );
    expect(res.status).toBe(201);
  });
});
