import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SHORT_ID } from '@/constants/app';

/**
 * `last_outcome_event_at` is the "there is output you haven't seen" signal —
 * it drives the rail's Unread bucket, the header's Respond state, and the
 * orchestrator's "what needs my attention".
 *
 * A subagent narrating to its own caller is not the session answering the
 * user. Before attribution existed, a fan-out of research subagents bumped
 * this on every line they spoke, so a session the user had just opened
 * flipped back to unread seconds later, over and over, for as long as the
 * subagents ran.
 */
describe('subagent events and the unread signal', () => {
  let directory: string;
  const dbEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
  const rootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  const previous: Record<string, string | undefined> = {};

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-subagent-outcome-'));
    previous[dbEnv] = process.env[dbEnv];
    previous[rootEnv] = process.env[rootEnv];
    process.env[dbEnv] = path.join(directory, 'data.db');
    process.env[rootEnv] = directory;
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of [dbEnv, rootEnv]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const LAUNCH_CALL_ID = 'toolu_014YX2';

  async function setup() {
    const queries = await import('./queries');
    const agent = queries.getOrCreateDefaultExecutor('claude');
    const session = queries.createChatSession({
      agentId: agent.id,
      type: 'execution',
      userId: 'local',
    });
    // The `Agent` launch always precedes its children on the stream, and the
    // gate resolves the parent tool by name — so the row has to be there.
    queries.insertChatEvent({
      sessionId: session.id,
      role: 'assistant',
      source: 'tool_call',
      toolName: 'Agent',
      toolInput: { description: 'Find playbank page implementation' },
      externalToolCallId: LAUNCH_CALL_ID,
      createdAt: '2026-08-25T12:18:30.000Z',
    });
    return { queries, sessionId: session.id };
  }

  it('bumps the outcome for the session\'s own reply', async () => {
    const { queries, sessionId } = await setup();
    queries.insertChatEvent({
      sessionId,
      role: 'assistant',
      source: 'agent',
      content: 'Done, all tests pass.',
      createdAt: '2026-08-25T12:30:00.000Z',
    });
    expect(queries.getChatSession(sessionId)?.lastOutcomeEventAt).toBe(
      '2026-08-25T12:30:00.000Z',
    );
  });

  it('does not bump the outcome for a subagent line', async () => {
    const { queries, sessionId } = await setup();
    queries.insertChatEvent({
      sessionId,
      role: 'assistant',
      source: 'agent',
      content: "I'll explore the app to understand the playbank...",
      externalParentToolCallId: LAUNCH_CALL_ID,
      createdAt: '2026-08-25T12:18:33.394Z',
    });
    expect(queries.getChatSession(sessionId)?.lastOutcomeEventAt).toBeNull();
  });

  it('leaves an already-read session read while subagents narrate', async () => {
    // The exact live regression: the main agent replies, the user reads it,
    // then background subagents keep talking. The session must stay read.
    const { queries, sessionId } = await setup();
    queries.insertChatEvent({
      sessionId,
      role: 'assistant',
      source: 'agent',
      content: "I've launched four parallel research agents.",
      createdAt: '2026-08-25T12:18:31.000Z',
    });
    for (const [i, line] of [
      "I'll explore the app...",
      'Let me read the core files.',
      'I have the complete picture. Here is my report...',
    ].entries()) {
      queries.insertChatEvent({
        sessionId,
        role: 'assistant',
        source: 'agent',
        content: line,
        externalParentToolCallId: LAUNCH_CALL_ID,
        createdAt: `2026-08-25T12:19:${String(40 + i).padStart(2, '0')}.000Z`,
      });
    }
    // Outcome is still pinned to the main agent's reply, not the subagents'.
    expect(queries.getChatSession(sessionId)?.lastOutcomeEventAt).toBe(
      '2026-08-25T12:18:31.000Z',
    );
  });

  it('still bumps once the main agent resumes after the subagents finish', async () => {
    const { queries, sessionId } = await setup();
    queries.insertChatEvent({
      sessionId,
      role: 'assistant',
      source: 'agent',
      content: 'subagent chatter',
      externalParentToolCallId: LAUNCH_CALL_ID,
      createdAt: '2026-08-25T12:19:47.000Z',
    });
    queries.insertChatEvent({
      sessionId,
      role: 'assistant',
      source: 'agent',
      content: 'Server done. Now the client.',
      createdAt: '2026-08-25T12:26:09.000Z',
    });
    expect(queries.getChatSession(sessionId)?.lastOutcomeEventAt).toBe(
      '2026-08-25T12:26:09.000Z',
    );
  });

  it('keeps subagent work in the activity signal that drives sort order', async () => {
    // Only the "needs you" signal is scoped to the top-level actor. A session
    // whose subagents are grinding away is still actively working and must
    // not sink in the rail.
    const { queries, sessionId } = await setup();
    const before = queries.getChatSession(sessionId)?.lastActivityAt ?? null;
    expect(before).not.toBeNull();
    // `bumpSessionActivity` is monotonic (`max(existing, at)`), so the event
    // has to be newer than session creation for the bump to be observable.
    const at = new Date(Date.parse(before!) + 1000).toISOString();
    queries.insertChatEvent({
      sessionId,
      role: 'assistant',
      source: 'agent',
      content: 'subagent chatter',
      externalParentToolCallId: LAUNCH_CALL_ID,
      createdAt: at,
    });
    const after = queries.getChatSession(sessionId)?.lastActivityAt ?? null;
    expect(after).toBe(at);
    // ...and it still did not count as output the user is waiting on.
    expect(queries.getChatSession(sessionId)?.lastOutcomeEventAt).toBeNull();
  });
});

describe('the outcome gate keys on the parent tool, not the tag', () => {
  let directory: string;
  const dbEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
  const rootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  const previous: Record<string, string | undefined> = {};

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-outcome-parent-'));
    previous[dbEnv] = process.env[dbEnv];
    previous[rootEnv] = process.env[rootEnv];
    process.env[dbEnv] = path.join(directory, 'data.db');
    process.env[rootEnv] = directory;
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of [dbEnv, rootEnv]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function sessionWithLaunch(toolName: string, callId: string) {
    const queries = await import('./queries');
    const agent = queries.getOrCreateDefaultExecutor('claude');
    const session = queries.createChatSession({
      agentId: agent.id,
      type: 'execution',
      userId: 'local',
    });
    queries.insertChatEvent({
      sessionId: session.id,
      role: 'assistant',
      source: 'tool_call',
      toolName,
      externalToolCallId: callId,
      createdAt: '2026-08-25T12:00:00.000Z',
    });
    return { queries, sessionId: session.id };
  }

  it('still bumps for a background task that completed inside a Skill', async () => {
    // A Skill runs as the session, just scoped. For a detached background
    // task the terminal summary is the only signal the user ever gets —
    // swallowing it would lose the result outright.
    const { queries, sessionId } = await sessionWithLaunch('Skill', 'toolu_skill');
    queries.insertChatEvent({
      sessionId,
      role: 'system',
      source: 'background_task',
      content: 'Deploy finished',
      externalParentToolCallId: 'toolu_skill',
      createdAt: '2026-08-25T12:05:00.000Z',
    });
    expect(queries.getChatSession(sessionId)?.lastOutcomeEventAt).toBe(
      '2026-08-25T12:05:00.000Z',
    );
  });

  it('suppresses the same event when it came from a subagent', async () => {
    const { queries, sessionId } = await sessionWithLaunch('Agent', 'toolu_agent');
    queries.insertChatEvent({
      sessionId,
      role: 'system',
      source: 'background_task',
      content: 'Subagent finished',
      externalParentToolCallId: 'toolu_agent',
      createdAt: '2026-08-25T12:05:00.000Z',
    });
    expect(queries.getChatSession(sessionId)?.lastOutcomeEventAt).toBeNull();
  });

  it('bumps for text emitted under a Skill, since that is the session speaking', async () => {
    const { queries, sessionId } = await sessionWithLaunch('Skill', 'toolu_skill');
    queries.insertChatEvent({
      sessionId,
      role: 'assistant',
      source: 'agent',
      content: 'Here is the result.',
      externalParentToolCallId: 'toolu_skill',
      createdAt: '2026-08-25T12:06:00.000Z',
    });
    expect(queries.getChatSession(sessionId)?.lastOutcomeEventAt).toBe(
      '2026-08-25T12:06:00.000Z',
    );
  });
});
