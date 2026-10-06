import { describe, it, expect } from 'vitest';
import {
  approvalDecisions,
  approvalItemState,
  approvalRequestView,
  approvalResponseView,
  coalesceApprovalRequests,
  countStates,
} from './integration-approvals';

type Row = { id: string; source: string; toolInput?: unknown };

const request = (id: string, approvalId: string, actionId = 'google_calendar.delete_event', connectionId = 'conn-1'): Row => ({
  id,
  source: 'approval_request',
  toolInput: {
    approvalId,
    actionId,
    connectionId,
    toolName: actionId.replace('.', '__'),
    actionLabel: 'Delete event',
    toolkitName: 'Google Calendar',
    providerId: 'google',
    account: 'me@example.com',
    risk: 'high',
    outward: false,
    summary: `Event ${approvalId}`,
    details: [{ label: 'Event id', value: approvalId }],
  },
});
const response = (id: string, outcome: string, approvalIds: string[]): Row => ({
  id,
  source: 'approval_response',
  toolInput: { outcome, approvalIds, actionId: 'google_calendar.delete_event', toolName: 't', actionLabel: 'Delete event', toolkitName: 'G', account: null },
});
const row = (id: string, source: string): Row => ({ id, source });

describe('approvalRequestView / approvalResponseView', () => {
  it('reads the persisted views', () => {
    expect(approvalRequestView(request('r1', 'a1'))).toMatchObject({
      approvalId: 'a1',
      actionLabel: 'Delete event',
      account: 'me@example.com',
      details: [{ label: 'Event id', value: 'a1' }],
    });
    expect(approvalResponseView(response('x', 'deny', ['a1']))).toMatchObject({ outcome: 'deny', approvalIds: ['a1'] });
  });

  it('rejects other rows and malformed payloads', () => {
    expect(approvalRequestView(row('t', 'tool_call'))).toBeNull();
    expect(approvalRequestView({ id: 'r', source: 'approval_request', toolInput: { approvalId: 1 } })).toBeNull();
    expect(approvalResponseView({ id: 'x', source: 'approval_response', toolInput: { outcome: 'maybe', approvalIds: [] } })).toBeNull();
  });
});

describe('coalesceApprovalRequests', () => {
  it('folds a parallel batch of one kind into its first row', () => {
    const events = [
      row('u', 'user'),
      row('c1', 'tool_call'),
      row('c2', 'tool_call'),
      row('c3', 'tool_call'),
      request('r1', 'a1'),
      request('r2', 'a2'),
      row('t1', 'tool_result'),
      request('r3', 'a3'),
      row('t2', 'tool_result'),
      row('m', 'agent'),
    ];
    const { events: out, groups } = coalesceApprovalRequests(events);
    expect(out.map((e) => e.id)).toEqual(['u', 'c1', 'c2', 'c3', 'r1', 't1', 't2', 'm']);
    expect(groups.get('r1')!.map((e) => e.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('keeps different actions, and the same action on another account, as separate cards', () => {
    const { events: out, groups } = coalesceApprovalRequests([
      request('r1', 'a1'),
      request('r2', 'a2', 'gmail.send_email'),
      request('r3', 'a3', 'google_calendar.delete_event', 'conn-2'),
      request('r4', 'a4'),
    ]);
    expect(out.map((e) => e.id)).toEqual(['r1', 'r2', 'r3']);
    expect(groups.get('r1')!.map((e) => e.id)).toEqual(['r1', 'r4']);
    expect(groups.get('r2')).toHaveLength(1);
  });

  it('starts a new card after anything the reader sees (a message, a decision, the user)', () => {
    const { events: out } = coalesceApprovalRequests([
      request('r1', 'a1'),
      row('m', 'agent'),
      request('r2', 'a2'),
      response('d', 'approve', ['a2']),
      request('r3', 'a3'),
      row('u', 'user'),
      request('r4', 'a4'),
    ]);
    expect(out.map((e) => e.id)).toEqual(['r1', 'm', 'r2', 'd', 'r3', 'u', 'r4']);
  });
});

describe('approval state', () => {
  it('maps every id a response covers to its outcome, latest wins', () => {
    const decisions = approvalDecisions([
      response('d1', 'approve', ['a1', 'a2']),
      row('m', 'agent'),
      response('d2', 'settled', ['a3']),
    ]);
    expect(Object.fromEntries(decisions)).toEqual({ a1: 'approve', a2: 'approve', a3: 'settled' });
  });

  it('prefers a recorded decision, then the live set, and knows when it cannot tell yet', () => {
    const decisions = new Map([['a1', 'deny' as const]]);
    expect(approvalItemState('a1', decisions, new Set(['a1']))).toBe('deny');
    expect(approvalItemState('a2', decisions, new Set(['a2']))).toBe('pending');
    expect(approvalItemState('a2', decisions, new Set())).toBe('expired');
    expect(approvalItemState('a2', decisions, undefined)).toBe('loading');
  });

  it('counts states for the status line', () => {
    expect(countStates(['approve', 'approve', 'deny', 'expired'])).toEqual({ approve: 2, deny: 1, expired: 1 });
  });
});
