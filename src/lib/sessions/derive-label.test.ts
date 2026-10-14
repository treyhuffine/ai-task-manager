import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const executeMock = vi.fn();
let temporaryHandle: import('@agentex/agent').AgentSession | null = null;
vi.mock('@agentex/agent', async (importOriginal) => ({
  ...await importOriginal<typeof import('@agentex/agent')>(),
  getProvider: () => ({ execute: executeMock,
    ...(temporaryHandle ? { capabilities: { nativeTitleGeneration: true }, createSession: async () => temporaryHandle! } : {}),
  }),
}));

let nativeHandle: import('@agentex/agent').AgentSession | null = null;
vi.mock('@/lib/executor/placement', () => ({
  runnerFor: () => ({
    async generateTitle(id: string, request: import('@/lib/runner/types').TitleRequest) {
      const { generateRunnerTitle } = await import('@/lib/runner/titles');
      const { setGeneratedChatSessionLabel } = await import('@/lib/db/queries');
      await generateRunnerTitle(id, nativeHandle, request, (signal) => {
        if (signal.type === 'title_suggestion' && signal.title && signal.source) {
          setGeneratedChatSessionLabel(id, { label: signal.title, source: signal.source, expectedRevision: signal.expectedRevision });
        }
      });
    },
    setTitle: vi.fn(async () => {}),
  }),
}));

const TEST_DB = path.join(os.tmpdir(), `ri-derive-label-test-${process.pid}.db`);

beforeEach(() => {
  executeMock.mockReset();
  nativeHandle = null;
  temporaryHandle = null;
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.RI_DB_PATH = TEST_DB;
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
  const session = q.createChatSession({ type: 'orchestration', harness: 'claude', label: null, status: 'active' });
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


describe('background title restrictions', () => {
  it.each(['cursor', 'antigravity'] as const)('never runs title generation for disabled %s', async (harness) => {
    const { q, session } = await seedOrchestrationChat();
    q.updateChatSession(session.id, { harness, model: 'example-model' });
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'plan the launch', createdAt: at(1) });
    const flag = harness === 'cursor' ? 'NEXT_PUBLIC_RI_CURSOR_ENABLED' : 'NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED';
    vi.stubEnv(flag, 'false');
    try {
      const { deriveRetrospectiveLabel } = await import('./derive-label');
      await deriveRetrospectiveLabel(session.id);
      expect(executeMock).not.toHaveBeenCalled();
      expect(q.getChatSession(session.id)?.label).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps the snippet fallback for Antigravity even when it is enabled', async () => {
    const { q, session } = await seedOrchestrationChat();
    q.updateChatSession(session.id, { harness: 'antigravity', model: 'gemini-3.1-pro-high' });
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'plan the launch', createdAt: at(1) });
    const { deriveRetrospectiveLabel } = await import('./derive-label');
    await deriveRetrospectiveLabel(session.id);
    expect(executeMock).not.toHaveBeenCalled();
    expect(q.getChatSession(session.id)?.label).toBeNull();
  });
});


describe('native-first chat naming', () => {
  async function contentChat() {
    const { q, session } = await seedOrchestrationChat();
    q.updateChatSession(session.id, { type: 'content' });
    return { q, session };
  }

  it('reuses an existing native title without generation', async () => {
    const { q, session } = await contentChat();
    const generateNativeTitle = vi.fn(async () => 'New title');
    nativeHandle = { readTitle: async () => 'Existing native title', generateNativeTitle } as unknown as import('@agentex/agent').AgentSession;
    const { deriveAndSetSessionLabel } = await import('./derive-label');
    await deriveAndSetSessionLabel(session.id, 'request', 'claude');
    expect(q.getChatSession(session.id)).toMatchObject({ label: 'Existing native title', labelSource: 'native', labelRevision: 1 });
    expect(generateNativeTitle).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('uses native generation and falls back to Ri when it fails', async () => {
    const { q, session } = await contentChat();
    nativeHandle = { generateNativeTitle: async () => { throw new Error('Unsupported runtime'); } } as unknown as import('@agentex/agent').AgentSession;
    executeMock.mockResolvedValue({ status: 'completed', summary: '"Ri fallback title."' });
    const { deriveAndSetSessionLabel } = await import('./derive-label');
    await deriveAndSetSessionLabel(session.id, 'request', 'claude');
    expect(q.getChatSession(session.id)).toMatchObject({ label: 'Ri fallback title', labelSource: 'fallback' });
    expect(executeMock).toHaveBeenCalledOnce();
  });

  it('accepts a native generation suggestion without starting the Ri fallback', async () => {
    const { q, session } = await contentChat();
    nativeHandle = { generateNativeTitle: async () => 'Native suggestion' } as unknown as import('@agentex/agent').AgentSession;
    const { deriveAndSetSessionLabel } = await import('./derive-label');
    await deriveAndSetSessionLabel(session.id, 'request', 'claude');
    expect(q.getChatSession(session.id)).toMatchObject({ label: 'Native suggestion', labelSource: 'native' });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('leaves the fallback its own budget after a native timeout', async () => {
    const { q, session } = await contentChat();
    vi.useFakeTimers();
    try {
      nativeHandle = { generateNativeTitle: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        throw new Error('Native request timed out');
      } } as unknown as import('@agentex/agent').AgentSession;
      executeMock.mockImplementation(async ({ signal }) => {
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        signal.throwIfAborted();
        return { status: 'completed', summary: 'Fallback after timeout' };
      });
      const { deriveAndSetSessionLabel } = await import('./derive-label');
      const pending = deriveAndSetSessionLabel(session.id, 'request', 'claude');
      await vi.advanceTimersByTimeAsync(30_000);
      expect(executeMock).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(20_000);
      await pending;
      expect(q.getChatSession(session.id)).toMatchObject({ label: 'Fallback after timeout', labelSource: 'fallback' });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['User name', null])('a late fallback cannot overwrite a manual rename or clear: %s', async (manual) => {
    const { q, session } = await contentChat();
    let resolve!: (value: { status: string; summary: string }) => void;
    executeMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { deriveAndSetSessionLabel } = await import('./derive-label');
    const pending = deriveAndSetSessionLabel(session.id, 'request', 'codex');
    await vi.waitFor(() => expect(executeMock).toHaveBeenCalledOnce());
    expect(executeMock.mock.calls[0][0].config.extraArgs).toContain('--skip-git-repo-check');
    q.updateChatSession(session.id, { label: manual });
    resolve({ status: 'completed', summary: 'Late automatic name' });
    await pending;
    expect(q.getChatSession(session.id)).toMatchObject({ label: manual, labelSource: 'manual', labelRevision: 1 });
  });

  it('retrospective requests generate fresh titles and preserve manual names', async () => {
    const { q, session } = await seedOrchestrationChat();
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'plan the launch', createdAt: at(1) });
    q.setGeneratedChatSessionLabel(session.id, { label: 'Old automatic name', source: 'native', expectedRevision: 0 });
    const readTitle = vi.fn(async () => 'Old native name');
    nativeHandle = { readTitle, generateNativeTitle: async () => 'Fresh retrospective name' } as unknown as import('@agentex/agent').AgentSession;
    const { deriveRetrospectiveLabel } = await import('./derive-label');
    await deriveRetrospectiveLabel(session.id);
    expect(q.getChatSession(session.id)?.label).toBe('Fresh retrospective name');
    expect(readTitle).not.toHaveBeenCalled();
    q.updateChatSession(session.id, { label: 'Manual name' });
    await deriveRetrospectiveLabel(session.id);
    expect(q.getChatSession(session.id)?.label).toBe('Manual name');
  });
});


describe('native naming after a chat closes', () => {
  it('uses the native operation on a short-lived control session and closes it', async () => {
    const { q, session } = await seedOrchestrationChat();
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'plan a vegetable garden', createdAt: at(1) });
    const generateNativeTitle = vi.fn(async () => 'Garden planning');
    const close = vi.fn(async () => {});
    temporaryHandle = { generateNativeTitle, close } as unknown as import('@agentex/agent').AgentSession;
    const { deriveRetrospectiveLabel } = await import('./derive-label');
    await deriveRetrospectiveLabel(session.id);
    expect(generateNativeTitle).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(executeMock).not.toHaveBeenCalled();
    expect(q.getChatSession(session.id)).toMatchObject({ label: 'Garden planning', labelSource: 'native' });
  });
});
