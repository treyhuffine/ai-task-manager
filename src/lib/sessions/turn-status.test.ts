/**
 * Status lines (docs/chat-status-lines.md): a chat's agent sets one at the end
 * of its turn, a status that waits on the person keeps the chat unread after a
 * look, and a new message, an explicit Mark as read or turning the trial off
 * clears it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let root: string;
const saved = new Map<string, string | undefined>();
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-turn-status-'));
  for (const key of ['RI_ROOT', 'RI_DB_PATH', 'RI_MIRROR_DISABLED']) saved.set(key, process.env[key]);
  process.env.RI_ROOT = root;
  process.env.RI_DB_PATH = path.join(root, 'data.db');
  process.env.RI_MIRROR_DISABLED = '1';
  vi.resetModules();
  const { resetDb } = await import('@/lib/db');
  resetDb();
});
afterEach(async () => {
  const { resetDb } = await import('@/lib/db');
  resetDb();
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const caller = (sessionId: string) => ({ remote: true, actor: { source: 'ai' as const, sessionId } });

async function executionChat() {
  const q = await import('@/lib/db/queries');
  const workspace = q.createWorkspace({ name: 'Website', cwd: root, isGit: false });
  const execution = q.createExecution({ workspaceId: workspace.id });
  const chat = q.createChatSession({ type: 'execution', harness: 'claude', workspaceId: workspace.id, executionId: execution.id });
  return { q, chat };
}

const listed = (q: typeof import('@/lib/db/queries'), id: string) =>
  q.listNeedsReviewSessionCandidates().some((s) => s.id === id);

describe('set_chat_status', () => {
  it("sets the calling chat's own status line", async () => {
    const { q, chat } = await executionChat();
    const { runAction } = await import('@/lib/orchestrator/dispatch');
    const response = await runAction('set_chat_status', {
      line: 'Pick A or B for the pricing table', needs_you: true, effort: 'quick', unblocks: 'the pricing page release',
    }, caller(chat.id));
    expect(response.ok).toBe(true);
    expect(q.getChatSession(chat.id)?.turnStatus).toMatchObject({
      line: 'Pick A or B for the pricing table', needsYou: true, effort: 'quick', unblocks: 'the pricing page release',
    });
  });

  it("keeps a report's line and drops the size and payoff that only an ask has", async () => {
    const { q, chat } = await executionChat();
    const { runAction } = await import('@/lib/orchestrator/dispatch');
    await runAction('set_chat_status', { line: 'Merged the login fix, nothing needed', needs_you: false, effort: 'block', unblocks: 'x' }, caller(chat.id));
    expect(q.getChatSession(chat.id)?.turnStatus).toMatchObject({ line: 'Merged the login fix, nothing needed', needsYou: false, effort: null, unblocks: null });
  });

  it('needs a signed chat, and refuses while status lines are off', async () => {
    const { q, chat } = await executionChat();
    const { runAction } = await import('@/lib/orchestrator/dispatch');
    expect((await runAction('set_chat_status', { line: 'x', needs_you: false }, { remote: true })).error?.code).toBe('unsupported');
    q.updateUserState({ chatStatusLines: false });
    expect((await runAction('set_chat_status', { line: 'x', needs_you: false }, caller(chat.id))).error?.code).toBe('unsupported');
    expect(q.getChatSession(chat.id)?.turnStatus).toBeNull();
  });
});

describe('a status that waits on the person', () => {
  const ask = { line: 'Test the preview on your phone', needsYou: true, effort: 'minutes' as const, unblocks: null, at: new Date().toISOString() };

  it('keeps the chat unread after a look, until marked read', async () => {
    const { q, chat } = await executionChat();
    const { markConversationRead } = await import('./view-state');
    const { isSessionUnread } = await import('@/lib/utils/session-sort');
    q.setChatTurnStatus(chat.id, ask);
    markConversationRead(null, chat.id, true);
    expect(isSessionUnread(q.getChatSession(chat.id)!)).toBe(true);
    expect(listed(q, chat.id)).toBe(true);

    // Mark as read is the person saying they've dealt with it.
    markConversationRead(null, chat.id, true, { dismiss: true });
    expect(q.getChatSession(chat.id)?.turnStatus).toBeNull();
    expect(isSessionUnread(q.getChatSession(chat.id)!)).toBe(false);
    expect(listed(q, chat.id)).toBe(false);
  });

  it("doesn't keep a report unread", async () => {
    const { q, chat } = await executionChat();
    const { markConversationRead } = await import('./view-state');
    q.setChatTurnStatus(chat.id, { ...ask, needsYou: false, effort: null });
    markConversationRead(null, chat.id, true);
    expect(listed(q, chat.id)).toBe(false);
    expect(q.getChatSession(chat.id)?.turnStatus?.line).toBe('Test the preview on your phone');
  });

  it("is cleared by a new message to the chat, not by the agent's own output", async () => {
    const { q, chat } = await executionChat();
    q.setChatTurnStatus(chat.id, ask);
    q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'One more thing.' });
    expect(q.getChatSession(chat.id)?.turnStatus).not.toBeNull();
    q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'Go with A.' });
    expect(q.getChatSession(chat.id)?.turnStatus).toBeNull();
  });

  it('is cleared everywhere when status lines are turned off', async () => {
    const { q, chat } = await executionChat();
    q.setChatTurnStatus(chat.id, ask);
    q.updateUserState({ chatStatusLines: false });
    expect(q.getChatSession(chat.id)?.turnStatus).toBeNull();
    expect(q.chatStatusLinesEnabled()).toBe(false);
  });
});

describe('the rule in the brief', () => {
  it("rides an execution's messages while status lines are on, and nothing else", async () => {
    const { q, chat } = await executionChat();
    const { turnStatusInstructions } = await import('./turn-status-instructions');
    const { withWorkResultSessionInstructions } = await import('@/lib/work-results/instructions');
    const rule = turnStatusInstructions(chat);
    expect(rule).toContain('set_chat_status');
    expect(rule).toContain('verb first');
    expect(withWorkResultSessionInstructions('Fix the login bug', null, [rule])).toContain('# Status line');
    // Not for a chat that isn't an execution's, nor a reviewer.
    expect(turnStatusInstructions({ executionId: null, surfaceKind: null })).toBe('');
    expect(turnStatusInstructions({ executionId: chat.executionId, surfaceKind: 'result_review' })).toBe('');
    q.updateUserState({ chatStatusLines: false });
    expect(turnStatusInstructions(chat)).toBe('');
  });
});
