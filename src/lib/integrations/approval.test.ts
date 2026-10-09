import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ApprovalCheckInput, Caller } from '@integrations/engine';
import { subscribe, sessionChannel, type SessionStreamMessage } from '@/lib/realtime/bus';
import { NOTIFIER_CALLER } from '@/lib/notifications/caller';

import {
  appApprovalPolicy,
  listPendingApprovals,
  resolvePendingApprovals,
  sessionCaller,
  sessionIdFromCaller,
  publishSessionApprovals,
  _resetApprovals,
  GRANT_TTL_MS,
  type PendingApproval,
} from './approval';
import { setActionOverride } from './write-policy';

// The transcript/notification side effects are covered in approval-events.test.ts. Here they're
// observed, not run, so the gate stays a pure in-memory unit.
const events = {
  recordApprovalRequested: vi.fn<(pending: PendingApproval) => Promise<void>>(async () => {}),
  recordApprovalsSettled: vi.fn<(settled: PendingApproval[]) => Promise<void>>(async () => {}),
};
const policy = (opts: { autoApprove?: boolean } = {}) =>
  appApprovalPolicy({
    ...opts,
    onRequested: events.recordApprovalRequested,
    onSettled: events.recordApprovalsSettled,
  });

const CHAT = 'chat-1';
const OTHER_CHAT = 'chat-2';

function check(overrides: Partial<ApprovalCheckInput> & { caller?: Caller } = {}): ApprovalCheckInput {
  return {
    actionId: 'google_calendar.delete_event',
    actionVersion: 'v1',
    risk: 'high',
    mutating: true,
    connection: {
      id: 'conn-1',
      ownerId: 'local',
      providerId: 'google',
      accountId: 'acct-1',
      email: 'clhuffine@gmail.com',
      scopes: [],
    },
    inputDigest: 'digest-a',
    inputPreview: { calendarId: 'primary', eventId: 'evt-a' },
    caller: sessionCaller(CHAT),
    ...overrides,
  };
}

const dirs: string[] = [];
const prevConfigDir = process.env.RI_CONFIG_DIR;

beforeEach(() => {
  _resetApprovals();
  events.recordApprovalRequested.mockClear();
  events.recordApprovalsSettled.mockClear();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-'));
  dirs.push(dir);
  process.env.RI_CONFIG_DIR = dir;
});

afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  if (prevConfigDir === undefined) delete process.env.RI_CONFIG_DIR;
  else process.env.RI_CONFIG_DIR = prevConfigDir;
});

describe('session caller identity', () => {
  it('round-trips a chat session through the MCP caller', () => {
    expect(sessionCaller('abc')).toEqual({ type: 'mcp', id: 'session:abc' });
    expect(sessionIdFromCaller(sessionCaller('abc'))).toBe('abc');
  });

  it('ignores callers that are not a session MCP call', () => {
    expect(sessionIdFromCaller(undefined)).toBeNull();
    expect(sessionIdFromCaller({ type: 'mcp' })).toBeNull();
    expect(sessionIdFromCaller({ type: 'agent', id: 'session:abc' })).toBeNull();
    expect(sessionIdFromCaller(NOTIFIER_CALLER)).toBeNull();
  });
});

describe('appApprovalPolicy', () => {
  it('isolates two apps, invocations and broker calls from anonymous and chat approval slots',async()=>{
    const gate=policy(),base={instanceId:'app-a',invocationId:'inv-a',callId:'call-a',principal:{kind:'chat' as const,id:CHAT}},caller=(localApp:typeof base)=>({type:'app' as const,id:'local-app',localApp});
    const a=check({caller:caller(base)}),b=check({caller:caller({...base,instanceId:'app-b'})}),next=check({caller:caller({...base,invocationId:'inv-b'})}),otherCall=check({caller:caller({...base,callId:'call-b'})});
    for(const request of [a,b,next,otherCall,check({caller:{type:'app'}})])expect(await gate.check(request)).toBe('ask');
    const pending=listPendingApprovals();expect(pending).toHaveLength(5);expect(events.recordApprovalRequested).toHaveBeenCalledTimes(1);
    resolvePendingApprovals([pending.find(item=>item.localApp?.instanceId==='app-a'&&item.localApp.invocationId==='inv-a'&&item.localApp.callId==='call-a')!.id],'approve');
    for(const request of [b,next,otherCall,check({caller:{type:'app'}}),check()])expect(await gate.check(request)).toBe('ask');expect(await gate.check(a)).toBe('allow');expect(await gate.check(a)).toBe('ask');
  });
  it('lets reads, dev auto-approve, and the notifier delivery through without a pending', async () => {
    const gate = policy();
    expect(await gate.check(check({ mutating: false }))).toBe('allow');
    expect(await policy({ autoApprove: true }).check(check())).toBe('allow');
    expect(
      await gate.check(check({ actionId: 'telegram.send_message', risk: 'low', caller: NOTIFIER_CALLER })),
    ).toBe('allow');
    expect(listPendingApprovals()).toEqual([]);
  });

  it('asks for an "Ask first" action and records which chat asked', async () => {
    const gate = policy();
    expect(await gate.check(check())).toBe('ask');
    const [pending] = listPendingApprovals();
    expect(pending).toMatchObject({
      actionId: 'google_calendar.delete_event',
      connectionId: 'conn-1',
      providerId: 'google',
      account: 'clhuffine@gmail.com',
      risk: 'high',
      sessionId: CHAT,
      preview: { calendarId: 'primary', eventId: 'evt-a' },
    });
    expect(pending).not.toHaveProperty('key');
    await vi.waitFor(() => expect(events.recordApprovalRequested).toHaveBeenCalledWith(pending));
  });

  it('dedupes a retried identical call per chat, but gives each chat its own request', async () => {
    const gate = policy();
    await gate.check(check());
    await gate.check(check());
    expect(listPendingApprovals({ sessionId: CHAT })).toHaveLength(1);
    await gate.check(check({ caller: sessionCaller(OTHER_CHAT) }));
    expect(listPendingApprovals()).toHaveLength(2);
    // A parallel batch of distinct calls is one request each.
    await gate.check(check({ inputDigest: 'digest-b', inputPreview: { eventId: 'evt-b' } }));
    expect(listPendingApprovals({ sessionId: CHAT })).toHaveLength(2);
  });

  it('publishes the chat’s live approval ids as they change', async () => {
    const frames: string[][] = [];
    const stop = subscribe(sessionChannel(CHAT), (m: SessionStreamMessage) => {
      if (m.kind === 'integration_approvals') frames.push(m.pending);
    });
    const gate = policy();
    await gate.check(check());
    const [pending] = listPendingApprovals();
    expect(frames.at(-1)).toEqual([pending!.id]);
    resolvePendingApprovals([pending!.id], 'deny');
    // Resolving leaves publishing to the caller, after it records the decision.
    expect(frames.at(-1)).toEqual([pending!.id]);
    publishSessionApprovals(CHAT);
    expect(frames.at(-1)).toEqual([]);
    stop();
  });
});

describe('resolvePendingApprovals', () => {
  it('approve grants the asking chat exactly one retry of that exact call', async () => {
    const gate = policy();
    await gate.check(check());
    const [pending] = listPendingApprovals();
    const { resolved, missing } = resolvePendingApprovals([pending!.id], 'approve');
    expect(resolved).toEqual([expect.objectContaining({ id: pending!.id, decision: 'approve' })]);
    expect(missing).toEqual([]);
    expect(listPendingApprovals()).toEqual([]);

    // Another chat making the identical call can't spend this chat's grant.
    expect(await gate.check(check({ caller: sessionCaller(OTHER_CHAT) }))).toBe('ask');
    // A different call from the same chat isn't covered either.
    expect(await gate.check(check({ inputDigest: 'digest-other' }))).toBe('ask');
    // The approved call runs once...
    expect(await gate.check(check())).toBe('allow');
    // ...and only once.
    expect(await gate.check(check())).toBe('ask');
  });

  it('a grant expires after the TTL', async () => {
    vi.useFakeTimers();
    const gate = policy();
    await gate.check(check());
    resolvePendingApprovals(listPendingApprovals().map((p) => p.id), 'approve');
    vi.advanceTimersByTime(GRANT_TTL_MS + 1);
    expect(await gate.check(check())).toBe('ask');
  });

  it('always also grants the retry (the route flips the policy separately)', async () => {
    const gate = policy();
    await gate.check(check());
    resolvePendingApprovals(listPendingApprovals().map((p) => p.id), 'always');
    expect(await gate.check(check())).toBe('allow');
  });

  it('deny clears the request without a grant', async () => {
    const gate = policy();
    await gate.check(check());
    const ids = listPendingApprovals().map((p) => p.id);
    expect(resolvePendingApprovals(ids, 'deny').resolved).toHaveLength(1);
    expect(listPendingApprovals()).toEqual([]);
    // The agent retrying anyway just asks again.
    expect(await gate.check(check())).toBe('ask');
    expect(listPendingApprovals()).toHaveLength(1);
  });

  it('reports ids that are no longer pending, resolving each id at most once', async () => {
    const gate = policy();
    await gate.check(check());
    const [pending] = listPendingApprovals();
    const first = resolvePendingApprovals([pending!.id, pending!.id, 'gone'], 'approve');
    expect(first.resolved).toHaveLength(1);
    expect(first.missing).toEqual(['gone']);
    expect(resolvePendingApprovals([pending!.id], 'approve')).toEqual({ resolved: [], missing: [pending!.id] });
  });
});

describe('moot requests', () => {
  it('settles a chat’s request once its identical call runs under the current policy', async () => {
    const gate = policy();
    await gate.check(check());
    await gate.check(check({ caller: sessionCaller(OTHER_CHAT) }));
    expect(listPendingApprovals()).toHaveLength(2);

    // The user switched "Ask first" off in settings, then the chat retried.
    setActionOverride('google_calendar.delete_event', 'auto');
    expect(await gate.check(check())).toBe('allow');

    // Only the chat whose call ran loses its request; approving it later would license a duplicate.
    expect(listPendingApprovals().map((p) => p.sessionId)).toEqual([OTHER_CHAT]);
    await vi.waitFor(() =>
      expect(events.recordApprovalsSettled).toHaveBeenCalledWith([expect.objectContaining({ sessionId: CHAT })]),
    );
  });
});

describe('listPendingApprovals', () => {
  it('filters by owner and chat, oldest first', async () => {
    const gate = policy();
    await gate.check(check({ inputDigest: 'd1' }));
    await gate.check(check({ inputDigest: 'd2', caller: sessionCaller(OTHER_CHAT) }));
    await gate.check(check({ inputDigest: 'd3', caller: { type: 'mcp' } }));
    expect(listPendingApprovals({ sessionId: OTHER_CHAT })).toHaveLength(1);
    expect(listPendingApprovals({ ownerId: 'someone-else' })).toEqual([]);
    const all = listPendingApprovals({ ownerId: 'local' });
    expect(all.map((p) => p.sessionId)).toEqual([CHAT, OTHER_CHAT, null]);
  });
});

it('binds an approval to one mentioned source, message and invocation within the same chat', async () => {
  const gate = policy();
  const source = { messageId: 'm1', sourceRef: 'exact-work-account', invocationId: 'i1' };
  const requests = [source, { ...source, invocationId: 'i2' }, { ...source, messageId: 'm2' }, { ...source, sourceRef: 'personal-account' }].map(chatSource => check({ caller: { ...sessionCaller(CHAT), chatSource } }));
  for (const request of requests) expect(await gate.check(request)).toBe('ask');
  const pending = listPendingApprovals(); expect(pending).toHaveLength(4);
  resolvePendingApprovals([pending.find(p => p.chatSource?.messageId === 'm1' && p.chatSource.invocationId === 'i1' && p.chatSource.sourceRef === source.sourceRef)!.id], 'approve');
  for (const request of requests.slice(1)) expect(await gate.check(request)).toBe('ask');
  expect(await gate.check(requests[0])).toBe('allow');
});
