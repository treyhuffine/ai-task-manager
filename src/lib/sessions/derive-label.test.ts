import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const executeMock = vi.fn();
vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ execute: executeMock }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));

const TEST_DB = path.join(os.tmpdir(), `flow-derive-label-test-${process.pid}.db`);

beforeEach(() => {
  executeMock.mockReset();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.FLOW_DB_PATH = TEST_DB;
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

async function seedOrchestrationChat() {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
  const q = await import('@/lib/db/queries');
  const agent = q.getOrCreateDefaultOrchestrator('claude_code');
  const session = q.createChatSession({ type: 'orchestration', agentId: agent.id, label: null, status: 'active' });
  return { q, session };
}

const at = (i: number) => new Date(Date.now() - (100 - i) * 1000).toISOString();

describe('buildRetrospectiveSample', () => {
  it('samples the opening user message plus recent prose, skipping tool noise', async () => {
    const { q, session } = await seedOrchestrationChat();
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'plan my week around the launch', createdAt: at(1) });
    q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'tool_call', content: null, toolName: 'mcp__orchestrator__list_tasks', createdAt: at(2) });
    q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: 'Here is the plan…', createdAt: at(3) });
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'also triage my stream', createdAt: at(4) });

    const { buildRetrospectiveSample } = await import('./derive-label');
    const sample = buildRetrospectiveSample(session.id)!;

    expect(sample).toContain('User: plan my week around the launch'); // opening preserved
    expect(sample).toContain('Assistant: Here is the plan…');
    expect(sample).toContain('User: also triage my stream');
    expect(sample).not.toContain('list_tasks'); // tool rows excluded
  });

  it('returns null for sessions with no prose', async () => {
    const { session } = await seedOrchestrationChat();
    const { buildRetrospectiveSample } = await import('./derive-label');
    expect(buildRetrospectiveSample(session.id)).toBeNull();
  });
});

describe('deriveRetrospectiveLabel', () => {
  it('writes the cleaned summary as the label', async () => {
    const { q, session } = await seedOrchestrationChat();
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'help me plan the launch week', createdAt: at(1) });
    executeMock.mockResolvedValue({ status: 'completed', summary: '"Launch week planning."' });

    const { deriveRetrospectiveLabel } = await import('./derive-label');
    await deriveRetrospectiveLabel(session.id);

    const row = q.getChatSession(session.id);
    expect(row?.label).toBe('Launch week planning'); // quotes + trailing punctuation stripped
  });

  it('leaves the label untouched when summarization fails — snippet fallback covers it', async () => {
    const { q, session } = await seedOrchestrationChat();
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'something', createdAt: at(1) });
    executeMock.mockRejectedValue(new Error('CLI unavailable'));

    const { deriveRetrospectiveLabel } = await import('./derive-label');
    await deriveRetrospectiveLabel(session.id);

    expect(q.getChatSession(session.id)?.label).toBeNull();
  });
});
