import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { ApprovalCheckInput } from '@integrations/engine';

/**
 * The approve route is the only way an approval gets answered: the user, from the approval card
 * in chat. Covers the human-only guard, batch decisions, "Always allow" going through the settings
 * store before anything resolves, and approvals that are already gone (restart, another tab).
 */

const h = vi.hoisted(() => ({
  allowWithoutAsking: vi.fn<(actionId: string, risk: string) => Promise<void>>(async () => {}),
  recordApprovalDecision: vi.fn<(resolved: unknown[], decision: string) => Promise<void>>(async () => {}),
}));
vi.mock('@/lib/integrations/approval-events', () => h);

import { POST } from './route';
import { appApprovalPolicy, listPendingApprovals, sessionCaller, _resetApprovals } from '@/lib/integrations/approval';

const gate = appApprovalPolicy({ onRequested: async () => {}, onSettled: async () => {} });

function ask(digest: string, actionId = 'google_calendar.delete_event'): Promise<unknown> {
  const input: ApprovalCheckInput = {
    actionId,
    actionVersion: 'v1',
    risk: 'high',
    mutating: true,
    connection: { id: 'conn-1', ownerId: 'local', providerId: 'google', accountId: 'a', scopes: [] },
    inputDigest: digest,
    inputPreview: { eventId: digest },
    caller: sessionCaller('chat-1'),
  };
  return gate.check(input);
}

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('http://localhost/api/integrations/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );
}

beforeEach(() => {
  _resetApprovals();
  h.allowWithoutAsking.mockClear();
  h.recordApprovalDecision.mockClear();
});

describe('POST /api/integrations/approve', () => {
  it('refuses a request carrying an agent session credential', async () => {
    await ask('d1');
    const ids = listPendingApprovals().map((p) => p.id);
    const res = await post({ ids, decision: 'approve' }, { 'x-ri-session': 'chat-1.sig' });
    expect(res.status).toBe(403);
    expect(listPendingApprovals()).toHaveLength(1);
  });

  it('validates the body', async () => {
    expect((await post({ decision: 'approve' })).status).toBe(400);
    expect((await post({ ids: ['x'], decision: 'maybe' })).status).toBe(400);
  });

  it('approves a batch and records the decision for the chat', async () => {
    await ask('d1');
    await ask('d2');
    const ids = listPendingApprovals().map((p) => p.id);
    const res = await post({ ids, decision: 'approve' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, decision: 'approve', resolved: ids, missing: [] });
    expect(listPendingApprovals()).toEqual([]);
    expect(h.recordApprovalDecision).toHaveBeenCalledWith(
      [expect.objectContaining({ id: ids[0], decision: 'approve' }), expect.objectContaining({ id: ids[1] })],
      'approve',
    );
    expect(h.allowWithoutAsking).not.toHaveBeenCalled();
    // The asking chat's retry now passes.
    expect(await ask('d1')).toBe('allow');
  });

  it('always allow flips each action once through the settings store, then resolves', async () => {
    await ask('d1');
    await ask('d2');
    await ask('d3', 'gmail.send_email');
    const ids = listPendingApprovals().map((p) => p.id);
    const res = await post({ ids, decision: 'always' });
    expect(res.status).toBe(200);
    expect(h.allowWithoutAsking.mock.calls).toEqual([
      ['google_calendar.delete_event', 'high'],
      ['gmail.send_email', 'high'],
    ]);
    expect(listPendingApprovals()).toEqual([]);
  });

  it('leaves the approvals pending when the policy flip fails', async () => {
    await ask('d1');
    h.allowWithoutAsking.mockRejectedValueOnce(new Error('MCP server "x" is no longer configured'));
    const res = await post({ ids: listPendingApprovals().map((p) => p.id), decision: 'always' });
    expect(res.status).toBe(500);
    expect(listPendingApprovals()).toHaveLength(1);
    expect(h.recordApprovalDecision).not.toHaveBeenCalled();
  });

  it('denies, and still accepts the legacy single-id form', async () => {
    await ask('d1');
    const [p] = listPendingApprovals();
    const res = await post({ id: p!.id, decision: 'deny' });
    expect(res.status).toBe(200);
    expect(h.recordApprovalDecision).toHaveBeenCalledWith([expect.objectContaining({ decision: 'deny' })], 'deny');
    expect(await ask('d1')).toBe('ask');
  });

  it('404s when nothing is pending anymore, and reports partial misses', async () => {
    const gone = await post({ ids: ['lost-to-restart'], decision: 'approve' });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ missing: ['lost-to-restart'] });

    await ask('d1');
    const [p] = listPendingApprovals();
    const partial = await post({ ids: [p!.id, 'lost-to-restart'], decision: 'approve' });
    expect(partial.status).toBe(200);
    expect(await partial.json()).toMatchObject({ resolved: [p!.id], missing: ['lost-to-restart'] });
  });
});
