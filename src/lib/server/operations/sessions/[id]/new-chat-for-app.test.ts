/**
 * A new chat a connected app asks for in an execution (`forApp`), where its
 * draft goes: the execution's newest chat is reused while nobody has written
 * in it, so an app asking again and again can't pile up chats.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';

let home: TestHome;
let fake: FakeHarness;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-new-chat-for-app-' });
  fake = installFakeHarness('claude');
});
afterEach(async () => {
  fake.restore();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  await home.cleanup();
});

async function newChat(id: string, body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/sessions/[id]/new-chat/route');
  const response = await POST(new Request('http://localhost/api/sessions/x/new-chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never, { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  return (await response.json()).session as { id: string };
}

describe('a new chat an app asks for in an execution', () => {
  it('reuses the newest chat while nobody has written in it, and opens another once someone has', async () => {
    const q = await import('@/lib/db/queries');
    const ws = q.createWorkspace({ name: 'Parts', cwd: home.root, isGit: false, filesToCopy: [], status: 'active' });
    const first = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: null }).session;
    q.insertChatEvent({ sessionId: first.id, role: 'user', source: 'user', content: 'Design the bracket' });
    const opened = await newChat(first.id, { forApp: true });
    expect(opened.id).not.toBe(first.id);
    // Asked again from the same view's chat: the fresh chat is reused, nothing piles up.
    for (let i = 0; i < 3; i++) expect((await newChat(first.id, { forApp: true })).id).toBe(opened.id);
    expect(q.listExecutionChatIds(first.executionId!)).toEqual([first.id, opened.id]);
    // Once the person writes in it, a new one opens.
    q.insertChatEvent({ sessionId: opened.id, role: 'user', source: 'user', content: 'Thicker walls' });
    const next = await newChat(first.id, { forApp: true });
    expect([first.id, opened.id]).not.toContain(next.id);
  });

  it('leaves the person\'s own New chat as it was', async () => {
    const q = await import('@/lib/db/queries');
    const ws = q.createWorkspace({ name: 'Parts', cwd: home.root, isGit: false, filesToCopy: [], status: 'active' });
    const first = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: null }).session;
    q.insertChatEvent({ sessionId: first.id, role: 'user', source: 'user', content: 'Design the bracket' });
    const opened = await newChat(first.id, {});
    expect(opened.id).not.toBe(first.id);
    expect((await newChat(opened.id, {})).id).not.toBe(opened.id);
  });
});
