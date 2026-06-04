import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Verifies the messages route's pre-flight behavior.
 *
 * Concurrent send: manual sends are NEVER gated on a run already in
 * flight against the execution. A follow-up reuses this chat's cached
 * AgentSession and the provider's native queue absorbs it. The route
 * used to run an execution-level mutex pre-flight that rejected a
 * user's own in-flight `trigger='manual'` turn with a misleading "a
 * scheduled run is in flight" 409; that gate is gone.
 *
 * Budget pre-flight remains, with one carve-out for retries: clients
 * re-POST the same `body.id` after a transient failure. Rejecting the
 * retry would surface an error while the original send is still in
 * flight, so the route peeks `getChatEventById(body.id)` first and
 * skips the budget gate when the row already exists, falling through to
 * the orphan-healing path. This test covers:
 *
 *  1. Fresh send while a run is in flight → 201 (concurrent send allowed)
 *  2. Retry (same body.id existed) → 201, dispatch delegated to health
 *  3. Fresh send → 201 (happy path)
 *  4. Fresh send + budget block → 402; retry + budget block → 201
 */

const getChatEventById = vi.fn();
const getChatSessionWithExecution = vi.fn();
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

describe('POST /api/sessions/[id]/messages — pre-flight behavior', () => {
  it('fresh send while a run is in flight → 201 (concurrent send allowed)', async () => {
    // No prior chat_event for this body.id. A previous turn for this
    // chat is still running — the user's own in-flight `manual` run.
    // This must NOT be rejected: concurrent sends ride the provider's
    // native queue. (Regression guard for the misleading "a scheduled
    // run is in flight" 409 the execution-mutex pre-flight used to
    // throw against a user's own turn.)
    getChatEventById.mockReturnValue(undefined);
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

  it('retry of an existing send → 201 (budget pre-flight bypassed, health redispatches)', async () => {
    // body.id matches a previously-persisted chat_event row — this is
    // a retry. The original send is already in flight; the route skips
    // the budget pre-flight and delegates the redispatch decision to
    // the orphan-healing path.
    getChatEventById.mockReturnValue({
      id: CLIENT_ID,
      sessionId: SESSION_ID,
      role: 'user',
      source: 'user',
      content: 'hello',
    });
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

  it('fresh send → 201 (happy path)', async () => {
    getChatEventById.mockReturnValue(undefined);
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
