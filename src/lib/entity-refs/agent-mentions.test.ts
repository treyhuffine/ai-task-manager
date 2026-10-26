import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

/**
 * An `@agent` mention against a real home: the message keeps its marker,
 * the chat's agent receives the mentioned agent's name, purpose and address,
 * and nothing lands in the chat's references (Notes & tasks), which hold
 * what the chat carries, not who it should involve.
 */

let home: TestHome;
const savedMirror = process.env.RI_MIRROR_DISABLED;

beforeEach(async () => {
  process.env.RI_MIRROR_DISABLED = '1';
  home = await createTestHome({ prefix: 'ri-agent-mentions-' });
});

afterEach(async () => {
  await home.cleanup();
  if (savedMirror === undefined) delete process.env.RI_MIRROR_DISABLED;
  else process.env.RI_MIRROR_DISABLED = savedMirror;
});

describe('an agent mention in a sent message', () => {
  it('expands for the chat and adds no chat reference', async () => {
    const q = await import('@/lib/db/queries');
    const { expandEntityMarkers } = await import('./expand-markers');
    const finances = q.createWorkspace({ name: 'Finances', cwd: '/tmp/ri-agent-mentions-finances', isGit: false, filesToCopy: [], status: 'active' });
    q.updateWorkspace(finances.id, { purpose: 'Tracks spending and budgets.' });
    const ri = q.createWorkspace({ name: 'Ri', cwd: '/tmp/ri-agent-mentions-ri', isGit: false, filesToCopy: [], status: 'active' });
    const session = q.createChatSession({ harness: 'claude', type: 'execution', status: 'active', workspaceId: ri.id, label: 'Mentions' });
    const task = q.createTask({ title: 'Export March', status: 'todo' });
    const content = `Ask [[agent:${finances.id}]] for [[task:${task.id}]]`;
    const event = q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content, createdAt: new Date().toISOString() });
    expect(event).toBeTruthy();

    const refs = q.materializeEventRefs(event!.id, session.id, content, { createdBy: 'user' });
    expect(refs.map((r) => [r.entityType, r.entityId])).toEqual([['task', task.id]]);

    expect(expandEntityMarkers(content, session.id)).toBe(
      `Ask <agent id="${finances.id}" name="Finances" address="agent:${finances.id}">\nTracks spending and budgets.\n</agent> for <task id="${task.id}" title="Export March" status="todo" />`,
    );
  });
});
