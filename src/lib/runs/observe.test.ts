/**
 * Classification tests for `observeRun`. Covers each `RunActivity`
 * branch with mocked executor state and synthetic chat_events.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true } }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));

const isRunningMock = vi.fn();
const isAgentSessionAliveMock = vi.fn();
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
  isRunning: (id: string) => (isRunningMock as unknown as (id: string) => boolean)(id),
  isAgentSessionAlive: (id: string) =>
    (isAgentSessionAliveMock as unknown as (id: string) => boolean)(id),
  ExecutorError: class extends Error {},
}));

const TEST_DB = path.join(os.tmpdir(), `flow-observe-test-${process.pid}.db`);

beforeEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.FLOW_DB_PATH = TEST_DB;
  isRunningMock.mockReset();
  isAgentSessionAliveMock.mockReset();
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

async function seedRun(overrides: {
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string | null;
  completedAt?: string | null;
} = {}) {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  const db = getDb();
  const { uuidv7 } = await import('uuidv7');
  const { workspaces, agents, chatSessions, runs } = await import('@/lib/db/schema');

  const wsId = uuidv7();
  db.insert(workspaces).values({
    id: wsId, name: 'TestWs', slug: 'testws-' + Date.now(),
    cwd: '/tmp/testws', isGit: false,
  }).run();
  const agentId = uuidv7();
  db.insert(agents).values({
    id: agentId, userId: 'local', kind: 'executor',
    name: 'Test', harness: 'claude_code', config: {}, status: 'active',
  }).run();
  const chatId = uuidv7();
  db.insert(chatSessions).values({
    id: chatId, userId: 'local', agentId,
    type: 'execution', workspaceId: wsId,
    permissionMode: 'bypass', status: 'active',
  }).run();
  const runId = uuidv7();
  db.insert(runs).values({
    id: runId,
    chatSessionId: chatId,
    workspaceId: wsId,
    agentId,
    triggerKind: 'manual',
    status: overrides.status ?? 'running',
    startedAt: overrides.startedAt === undefined ? new Date(Date.now() - 60_000).toISOString() : overrides.startedAt,
    completedAt: overrides.completedAt ?? null,
    queuedAt: new Date(Date.now() - 60_000).toISOString(),
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  }).run();
  return { runId, chatId };
}

async function insertEvent(chatId: string, opts: {
  source: string;
  toolName?: string | null;
  externalToolCallId?: string | null;
  ageMs?: number;
}) {
  const { getDb } = await import('@/lib/db');
  const { chatEvents } = await import('@/lib/db/schema');
  const { uuidv7 } = await import('uuidv7');
  const createdAt = new Date(Date.now() - (opts.ageMs ?? 0)).toISOString();
  getDb().insert(chatEvents).values({
    id: uuidv7(),
    sessionId: chatId,
    role: 'system',
    source: opts.source,
    toolName: opts.toolName ?? null,
    externalToolCallId: opts.externalToolCallId ?? null,
    createdAt,
  }).run();
}

describe('observeRun', () => {
  it('terminal: completed run', async () => {
    const { runId } = await seedRun({
      status: 'completed',
      completedAt: new Date(Date.now() - 5_000).toISOString(),
    });
    const { observeRun } = await import('./observe');
    const o = observeRun(runId)!;
    expect(o.activity.kind).toBe('terminal');
    expect(o.stallWarning).toBe(false);
  });

  it('queued: no events, no probe', async () => {
    const { runId } = await seedRun({ status: 'queued', startedAt: null });
    const { observeRun } = await import('./observe');
    const o = observeRun(runId)!;
    expect(o.activity.kind).toBe('queued');
  });

  it('crashed: subprocess gone but row says running', async () => {
    const { runId } = await seedRun({
      startedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    isRunningMock.mockReturnValue(false);
    isAgentSessionAliveMock.mockReturnValue(false);
    const { observeRun } = await import('./observe');
    const o = observeRun(runId)!;
    expect(o.activity.kind).toBe('crashed');
    expect(o.stallWarning).toBe(true);
    expect(o.processAlive).toBe(false);
  });

  it('awaiting_input: permission_request without response', async () => {
    const { runId, chatId } = await seedRun();
    isRunningMock.mockReturnValue(true);
    isAgentSessionAliveMock.mockReturnValue(true);
    await insertEvent(chatId, {
      source: 'permission_request',
      toolName: 'Bash',
      ageMs: 10_000,
    });
    const { observeRun } = await import('./observe');
    const o = observeRun(runId)!;
    expect(o.activity).toMatchObject({ kind: 'awaiting_input', toolName: 'Bash' });
    expect(o.stallWarning).toBe(false);
  });

  it('awaiting_input: cleared by a permission_response', async () => {
    const { runId, chatId } = await seedRun();
    isRunningMock.mockReturnValue(true);
    isAgentSessionAliveMock.mockReturnValue(true);
    await insertEvent(chatId, { source: 'permission_request', toolName: 'Bash', ageMs: 20_000 });
    await insertEvent(chatId, { source: 'permission_response', ageMs: 15_000 });
    await insertEvent(chatId, { source: 'agent', ageMs: 5_000 });
    const { observeRun } = await import('./observe');
    const o = observeRun(runId)!;
    expect(o.activity.kind).toBe('working');
  });

  it('tool_in_flight: tool_call with no matching tool_result', async () => {
    const { runId, chatId } = await seedRun();
    isRunningMock.mockReturnValue(true);
    isAgentSessionAliveMock.mockReturnValue(true);
    await insertEvent(chatId, {
      source: 'tool_call',
      toolName: 'Bash',
      externalToolCallId: 'tc-1',
      ageMs: 8 * 60_000,
    });
    const { observeRun } = await import('./observe');
    const o = observeRun(runId)!;
    expect(o.activity).toMatchObject({ kind: 'tool_in_flight', tool: 'Bash' });
    expect(o.stallWarning).toBe(true);
  });

  it('tool_in_flight: matched tool_result clears it', async () => {
    const { runId, chatId } = await seedRun();
    isRunningMock.mockReturnValue(true);
    isAgentSessionAliveMock.mockReturnValue(true);
    await insertEvent(chatId, {
      source: 'tool_call',
      toolName: 'Bash',
      externalToolCallId: 'tc-1',
      ageMs: 20_000,
    });
    await insertEvent(chatId, {
      source: 'tool_result',
      externalToolCallId: 'tc-1',
      ageMs: 15_000,
    });
    await insertEvent(chatId, { source: 'agent', ageMs: 5_000 });
    const { observeRun } = await import('./observe');
    const o = observeRun(runId)!;
    expect(o.activity.kind).toBe('working');
  });

  it('working: recent agent event', async () => {
    const { runId, chatId } = await seedRun();
    isRunningMock.mockReturnValue(true);
    isAgentSessionAliveMock.mockReturnValue(true);
    await insertEvent(chatId, { source: 'agent', ageMs: 5_000 });
    const { observeRun } = await import('./observe');
    const o = observeRun(runId)!;
    expect(o.activity.kind).toBe('working');
    expect(o.stallWarning).toBe(false);
  });

  it('stalled: no events for > 5 minutes', async () => {
    const { runId, chatId } = await seedRun();
    isRunningMock.mockReturnValue(true);
    isAgentSessionAliveMock.mockReturnValue(true);
    await insertEvent(chatId, { source: 'agent', ageMs: 7 * 60_000 });
    const { observeRun } = await import('./observe');
    const o = observeRun(runId)!;
    expect(o.activity.kind).toBe('stalled');
    expect(o.stallWarning).toBe(true);
  });

  it('quiet but not stalled (under threshold)', async () => {
    const { runId, chatId } = await seedRun();
    isRunningMock.mockReturnValue(true);
    isAgentSessionAliveMock.mockReturnValue(true);
    await insertEvent(chatId, { source: 'agent', ageMs: 90_000 });
    const { observeRun } = await import('./observe');
    const o = observeRun(runId)!;
    // Past ACTIVE_WINDOW but inside STALLED_WINDOW.
    expect(o.activity.kind).toBe('stalled');
    expect(o.stallWarning).toBe(false);
  });
});
