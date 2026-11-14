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
  revokeApprovalsForConnections,
  cancelConnectedAppApprovals,
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
  it('binds connected UI approval to the exact viewer, source, view and invocation', async () => {
    const gate = policy();
    const identity = {viewId: 'view-a', invocationId: 'inv-a', sourceRef: 'source-a', viewerId: 'viewer-a'};
    const request = (patch = {}) => check({caller: {...sessionCaller(CHAT), connectedApp: {...identity, ...patch}}});
    expect(await gate.check(request())).toBe('ask');
    const pending = listPendingApprovals()[0];
    expect(events.recordApprovalRequested).not.toHaveBeenCalled();
    resolvePendingApprovals([pending.id], 'approve');
    for (const patch of [{viewerId:'other'}, {viewId:'other'}, {invocationId:'other'}, {sourceRef:'other'}]) expect(await gate.check(request(patch))).toBe('ask');
    expect(await gate.check(check())).toBe('ask');
    expect(await gate.check(request())).toBe('allow');
    expect(await gate.check(request())).toBe('ask');
  });
  describe('a personal app through the hub', () => {
    const hub = (appId: string, startedBy: NonNullable<Caller['hubApp']>['startedBy']): Caller => ({ type: 'app', id: `hub:${appId}`, hubApp: { appId, startedBy } });
    const job = hub('bloom', { kind: 'job', label: 'import' });
    const send = (overrides: Partial<ApprovalCheckInput> = {}) => check({ actionId: 'gmail.send_email', risk: 'medium', ...overrides });

    it('asks for a write that reaches outside every time, even when the action runs without asking and in development', async () => {
      const gate = policy();
      setActionOverride('gmail.send_email', 'auto');
      try {
        expect(await gate.check(send({ caller: hub('bloom', { kind: 'chat', id: CHAT }) }))).toBe('ask');
        expect(await policy({ autoApprove: true }).check(send({ caller: job }))).toBe('ask');
        // The same write from the person's own agent follows their setting.
        expect(await gate.check(send())).toBe('allow');
      } finally { setActionOverride('gmail.send_email', null); }
      const pending = listPendingApprovals();
      // One pending for the app's call, wherever it was started from, shown in the chat that started it.
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ sessionId: CHAT, hubApp: { appId: 'bloom', startedBy: { kind: 'chat', id: CHAT } } });
      expect(events.recordApprovalRequested).toHaveBeenCalledTimes(1);
      expect(sessionIdFromCaller(job)).toBeNull();
      resolvePendingApprovals([pending[0]!.id], 'approve');
      // Another app, a chat's own call and an anonymous caller can't use Bloom's approval.
      expect(await gate.check(send({ caller: hub('finances', { kind: 'chat', id: CHAT }) }))).toBe('ask');
      expect(await gate.check(send({ caller: { type: 'mcp' } }))).toBe('ask');
      // Bloom's identical retry is allowed once, even from its job rather than the chat.
      expect(await gate.check(send({ caller: job }))).toBe('allow');
      expect(await gate.check(send({ caller: job }))).toBe('ask');
    });

    it('lets a write to the person\'s own data follow their usual setting, from a chat or a job', async () => {
      const gate = policy();
      const createEvent = check({ actionId: 'google_calendar.create_event', risk: 'medium', caller: job });
      // A reversible write to their own calendar runs without asking by default, as for any caller.
      expect(await gate.check(createEvent)).toBe('allow');
      // Pulled behind the gate by the person, it asks the app too.
      setActionOverride('google_calendar.create_event', 'ask');
      try { expect(await gate.check(createEvent)).toBe('ask'); } finally { setActionOverride('google_calendar.create_event', null); }
      // An irreversible one asks by default, and the person can let it run.
      const remove = check({ caller: job });
      expect(await gate.check(remove)).toBe('ask');
      setActionOverride('google_calendar.delete_event', 'auto');
      try { expect(await gate.check(remove)).toBe('allow'); } finally { setActionOverride('google_calendar.delete_event', null); }
      expect(await policy({ autoApprove: true }).check(check({ caller: job }))).toBe('allow');
      // Reads never ask.
      expect(await gate.check(check({ mutating: false, caller: hub('bloom', { kind: 'app' }) }))).toBe('allow');
    });

    it('takes the provider\'s word on whether a write reaches outside, where it gave one', async () => {
      const gate = policy();
      // A tool that posts but says it stays within the person's own data follows their setting, here
      // to run without asking. Without that word, its verb says it reaches outside, and it asks.
      setActionOverride('mcp.notes.post_entry', 'auto');
      try {
        expect(await gate.check(check({ actionId: 'mcp.notes.post_entry', risk: 'medium', openWorld: false, caller: job }))).toBe('allow');
        expect(await gate.check(check({ actionId: 'mcp.notes.post_entry', risk: 'medium', caller: job }))).toBe('ask');
      } finally { setActionOverride('mcp.notes.post_entry', null); }
      // A tool with a quiet name that says it reaches the open world asks, even set to run without asking.
      setActionOverride('mcp.docs.create_doc', 'auto');
      try { expect(await gate.check(check({ actionId: 'mcp.docs.create_doc', risk: 'medium', openWorld: true, caller: job }))).toBe('ask'); }
      finally { setActionOverride('mcp.docs.create_doc', null); }
    });
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

describe('revokeApprovalsForConnections', () => {
  it('drops pendings and unused grants for removed connections only, recording them settled', async () => {
    const gate = policy();
    expect(await gate.check(check())).toBe('ask');
    expect(await gate.check(check({ connection: { ...check().connection, id: 'conn-2', accountId: 'acct-2' }, inputDigest: 'digest-b' }))).toBe('ask');
    const [first] = listPendingApprovals();
    // An approved but not yet used grant for conn-1 must not outlive the connection either.
    resolvePendingApprovals([first!.id], 'approve');
    expect(await gate.check(check({ inputDigest: 'digest-c' }))).toBe('ask');
    events.recordApprovalsSettled.mockClear();
    const removed = revokeApprovalsForConnections(['conn-1'], events.recordApprovalsSettled);
    expect(removed.map((p) => p.connectionId)).toEqual(['conn-1']);
    expect(listPendingApprovals().map((p) => p.connectionId)).toEqual(['conn-2']);
    expect(events.recordApprovalsSettled).toHaveBeenCalledWith(removed);
    // The earlier approval's grant was dropped: the same call asks again.
    expect(await gate.check(check())).toBe('ask');
  });

  it('does nothing for no connections', () => {
    expect(revokeApprovalsForConnections([])).toEqual([]);
  });
});

it('cancels only the exact connected invocation and removes its unused approval grant', async () => {
  const gate = policy();
  const app = {viewId: 'view-a', invocationId: 'invoke-a', sourceRef: 'account-a', viewerId: 'viewer-a'};
  const other = {...app, invocationId: 'invoke-b'};
  const request = (connectedApp: typeof app) => check({caller: {...sessionCaller(CHAT), connectedApp}});
  await gate.check(request(app)); await gate.check(request(other));
  resolvePendingApprovals(listPendingApprovals().map(p => p.id), 'approve');
  // The request is already gone, but cancellation must revoke its unused grant.
  expect(cancelConnectedAppApprovals(app, CHAT)).toEqual([]);
  expect(await gate.check(request(app))).toBe('ask');
  expect(await gate.check(request(other))).toBe('allow');
  expect(cancelConnectedAppApprovals({...app, viewerId: 'someone-else'}, CHAT)).toEqual([]);
  expect(listPendingApprovals()).toHaveLength(1);
  expect(cancelConnectedAppApprovals(app, CHAT)).toMatchObject([{decision: 'deny', connectedApp: app}]);
  expect(listPendingApprovals()).toEqual([]);
});
