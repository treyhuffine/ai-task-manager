import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
beforeEach(async () => { home = await createTestHome({ prefix: 'ri-session-titles-' }); });
afterEach(async () => { await home.cleanup(); });

describe('title ownership and revision', () => {
  it('rejects late suggestions after a manual rename or clear, including after reopening the database', async () => {
    const q = await import('./queries');
    const { resetDb } = await import('@/lib/db');
    for (const label of ['Chosen name', null]) {
      const chat = q.createChatSession({ harness: 'claude', type: 'content' });
      q.updateChatSession(chat.id, { label });
      resetDb();
      expect(q.setGeneratedChatSessionLabel(chat.id, { label: 'Late name', source: 'fallback', expectedRevision: 0 })).toBeNull();
      expect(q.adoptNativeChatSessionLabel(chat.id, 'Native name')).toBeNull();
      expect(q.getChatSession(chat.id)).toMatchObject({ label, labelSource: 'manual', labelRevision: 1 });
    }
  });

  it('accepts a suggestion once and leaves unrelated updates out of the title revision', async () => {
    const q = await import('./queries');
    const chat = q.createChatSession({ harness: 'codex', type: 'content' });
    q.updateChatSession(chat.id, { scratchPad: 'Keep this' });
    expect(q.getChatSession(chat.id)?.labelRevision).toBe(0);
    expect(q.setGeneratedChatSessionLabel(chat.id, { label: 'Automatic', source: 'fallback', expectedRevision: 0 })).toMatchObject({ labelRevision: 1 });
    expect(q.setGeneratedChatSessionLabel(chat.id, { label: 'Replay', source: 'fallback', expectedRevision: 0 })).toBeNull();
  });

  it('preserves names created explicitly and keeps active main chats unlabeled', async () => {
    const q = await import('./queries');
    const named = q.createChatSession({ harness: 'codex', type: 'content', label: 'Explicit name' });
    expect(q.adoptNativeChatSessionLabel(named.id, 'Different native name')).toBeNull();
    const main = q.createChatSession({ harness: 'codex', type: 'orchestration' });
    expect(q.adoptNativeChatSessionLabel(main.id, 'First-message native name')).toBeNull();
    expect(q.getChatSession(main.id)?.label).toBeNull();
  });

  it('seeds the execution header once and preserves a manual header clear', async () => {
    const q = await import('./queries');
    const workspace = q.createWorkspace({ name: 'Titles', cwd: home.root, isGit: false });
    const execution = q.createExecution({ workspaceId: workspace.id });
    const first = q.createChatSession({ harness: 'claude', type: 'execution', executionId: execution.id });
    q.setGeneratedChatSessionLabel(first.id, { label: 'First chat', source: 'native', expectedRevision: 0 });
    expect(q.getExecution(execution.id)?.label).toBe('First chat');
    q.setExecutionLabel(execution.id, null);
    const second = q.createChatSession({ harness: 'claude', type: 'execution', executionId: execution.id });
    q.setGeneratedChatSessionLabel(second.id, { label: 'Second chat', source: 'native', expectedRevision: 0 });
    expect(q.getExecution(execution.id)?.label).toBeNull();
  });
});
