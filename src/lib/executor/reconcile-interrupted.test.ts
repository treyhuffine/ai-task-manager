/**
 * A restart never drops a chat silently (docs/always-on-spec.md 6.3): the
 * startup sweep marks a chat it cut off mid-turn as needing the person,
 * once, and leaves a finished chat alone.
 */
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { parseStreamEvent } from '@/lib/runner/parse';

let home: TestHome;
let q: typeof import('@/lib/db/queries');

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-reconcile-interrupted-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  q = await import('@/lib/db/queries');
});
afterEach(async () => { await home.cleanup(); });

/** Rows as a live chat writes them. Agent events go through the real parser,
 * which gives every one an ID. A person's message from this app has none. */
function chatWith(events: ({ person: string; secondsAgo: number } | { live: Record<string, unknown>; secondsAgo: number })[]) {
  const workspace = q.createWorkspace({ name: 'Interrupted', cwd: path.join(home.root, 'source'), isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const { session } = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: 'Long task' });
  q.updateChatSession(session.id, { externalSessionId: `external-${session.id}`, lastViewedAt: new Date(Date.now() - 10 * 60_000).toISOString() });
  for (const event of events) {
    const createdAt = new Date(Date.now() - event.secondsAgo * 1000).toISOString();
    if ('person' in event) q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: event.person, createdAt });
    else q.insertChatEvent({ ...parseStreamEvent(session.id, { timestamp: createdAt, ...event.live } as unknown as Parameters<typeof parseStreamEvent>[1])!, createdAt });
  }
  return session.id;
}

it('marks a chat the restart cut off as unread, once, and leaves a finished one alone', async () => {
  const cutOff = chatWith([{ person: 'run the tests', secondsAgo: 120 }, { live: { type: 'tool_call', name: 'Bash', input: {} }, secondsAgo: 20 }]);
  const finished = chatWith([{ person: 'run the tests', secondsAgo: 120 }, { live: { type: 'result' }, secondsAgo: 20 }]);
  const { reconcileAllSessions } = await import('./reconcile');
  const first = await reconcileAllSessions({ markInterrupted: true, redispatchOrphans: false });
  expect(first.interrupted).toBe(1);
  expect(q.getChatSession(cutOff)?.unreadMarkerAt).toBeTruthy();
  expect(q.getChatSession(finished)?.unreadMarkerAt).toBeFalsy();
  // Already unread: the next restart adds nothing.
  const marker = q.getChatSession(cutOff)?.unreadMarkerAt;
  expect((await reconcileAllSessions({ markInterrupted: true, redispatchOrphans: false })).interrupted).toBe(0);
  expect(q.getChatSession(cutOff)?.unreadMarkerAt).toBe(marker);
  // Only the startup sweep marks: opening a chat or the minute sweep never does.
  const another = chatWith([{ live: { type: 'tool_call', name: 'Bash', input: {} }, secondsAgo: 20 }]);
  expect((await reconcileAllSessions({ redispatchOrphans: false })).interrupted).toBe(0);
  expect(q.getChatSession(another)?.unreadMarkerAt).toBeFalsy();
}, 30_000);
