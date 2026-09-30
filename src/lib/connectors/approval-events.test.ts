import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const h = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, unknown>>(),
  inserted: [] as Record<string, unknown>[],
  dispatched: [] as { sessionId: string; executionId: string | null; text: string }[],
  notified: [] as Record<string, unknown>[],
  lookup: vi.fn(),
  mcpEntries: [] as {
    id: string;
    slug: string;
    displayName?: string;
    toolOverrides?: Record<string, { enabled?: boolean; mutating?: boolean }>;
  }[],
  mcpUpdates: [] as { id: string; patch: unknown }[],
  invalidated: 0,
}));

vi.mock('@/lib/db/queries', () => ({
  getChatSessionWithExecution: (id: string) => h.sessions.get(id) ?? null,
  insertChatEvent: (row: Record<string, unknown>) => {
    h.inserted.push(row);
    return { id: `row-${h.inserted.length}`, ...row };
  },
}));
vi.mock('@/lib/executor/health', () => ({ healthCheckSession: vi.fn(async () => ({})) }));
vi.mock('@/lib/sessions/deliver', () => ({
  dispatchSessionTurn: (sessionId: string, executionId: string | null, text: string) =>
    h.dispatched.push({ sessionId, executionId, text }),
}));
vi.mock('@/lib/notifications', () => ({
  notify: async (event: Record<string, unknown>) => {
    h.notified.push(event);
  },
}));
vi.mock('./runtime', () => ({
  getConnectorRuntime: async () => ({
    getToolkits: () => [
      {
        id: 'google_calendar',
        providerId: 'google',
        displayName: 'Google Calendar',
        actions: [
          { id: 'google_calendar.get_event', mutating: false },
          { id: 'google_calendar.delete_event', mutating: true },
        ],
      },
    ],
    runAction: h.lookup,
  }),
  getMcpServerStore: () => ({
    list: () => h.mcpEntries,
    update: async (id: string, patch: unknown) => {
      h.mcpUpdates.push({ id, patch });
      return {};
    },
  }),
  invalidateConnectorRuntime: () => {
    h.invalidated += 1;
  },
}));

import {
  allowWithoutAsking,
  recordApprovalDecision,
  recordApprovalRequested,
  recordApprovalsSettled,
} from './approval-events';
import { getActionOverride, setActionOverride } from './write-policy';
import type { PendingApproval, ResolvedApproval } from './approval';

const CHAT = 'chat-1';

function pending(id: string, overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id,
    ownerId: 'local',
    actionId: 'google_calendar.delete_event',
    connectionId: 'conn-1',
    providerId: 'google',
    account: 'clhuffine@gmail.com',
    risk: 'high',
    preview: { calendarId: 'primary', eventId: `evt-${id}` },
    sessionId: CHAT,
    createdAt: Date.parse('2026-09-29T15:00:00Z'),
    ...overrides,
  };
}

const resolved = (p: PendingApproval, decision: ResolvedApproval['decision']): ResolvedApproval => ({ ...p, decision });

beforeEach(() => {
  // Notifications batch on a timer. Fake timers keep one test's burst out of the next.
  vi.useFakeTimers();
  h.sessions.clear();
  h.sessions.set(CHAT, { id: CHAT, status: 'active', executionId: null, surfaceKind: null, externalSessionId: null });
  h.inserted.length = 0;
  h.dispatched.length = 0;
  h.notified.length = 0;
  h.mcpEntries.length = 0;
  h.mcpUpdates.length = 0;
  h.invalidated = 0;
  h.lookup.mockReset();
});

afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
});

describe('recordApprovalRequested', () => {
  it('writes an approval card row that names the target, looked up on the same connection', async () => {
    h.lookup.mockResolvedValue({ ok: true, result: { summary: 'Team standup', start: '2026-09-30' } });
    await recordApprovalRequested(pending('a1'));

    expect(h.lookup).toHaveBeenCalledWith(
      'google_calendar.get_event',
      { calendarId: 'primary', eventId: 'evt-a1' },
      expect.objectContaining({ ownerId: 'local', connectionId: 'conn-1', caller: { type: 'app', id: 'approval-preview' } }),
    );
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]).toMatchObject({
      sessionId: CHAT,
      role: 'system',
      source: 'approval_request',
      toolName: 'google_calendar__delete_event',
      content: 'Delete event: Team standup · Wed, Sep 30',
      externalEventId: 'connector-approval:a1',
      createdAt: '2026-09-29T15:00:00.000Z',
      toolInput: {
        approvalId: 'a1',
        actionId: 'google_calendar.delete_event',
        actionLabel: 'Delete event',
        toolkitName: 'Google Calendar',
        providerId: 'google',
        connectionId: 'conn-1',
        account: 'clhuffine@gmail.com',
        risk: 'high',
        outward: false,
        summary: 'Team standup · Wed, Sep 30',
      },
    });
  });

  it('still records the card when the lookup fails', async () => {
    h.lookup.mockResolvedValue({ ok: false, reason: 'error', code: 'not_found', message: 'gone' });
    await recordApprovalRequested(pending('a1'));
    expect(h.inserted[0]).toMatchObject({ toolInput: { summary: 'Event id evt-a1' } });
  });

  it('names an MCP tool by the server the user added, with no vestigial account', async () => {
    h.mcpEntries.push({ id: 'srv-1', slug: 'team_calendar', displayName: 'Team Calendar' });
    h.lookup.mockResolvedValue({ ok: false });
    await recordApprovalRequested(
      pending('a1', { actionId: 'mcp.team_calendar.delete_event', providerId: 'mcp_team_calendar', account: 'team_calendar' }),
    );
    expect(h.inserted[0]).toMatchObject({
      toolName: 'mcp__team_calendar__delete_event',
      toolInput: { toolkitName: 'Team Calendar', account: null, actionLabel: 'Delete event' },
    });
  });

  it('writes no row for a call with no chat, or a chat that no longer exists', async () => {
    h.lookup.mockResolvedValue({ ok: false });
    await recordApprovalRequested(pending('a1', { sessionId: null }));
    await recordApprovalRequested(pending('a2', { sessionId: 'deleted-chat' }));
    expect(h.inserted).toEqual([]);
  });

  it('sends one notification per burst, linking to the chat', async () => {
    h.lookup.mockResolvedValue({ ok: false });
    for (const id of ['a1', 'a2', 'a3']) await recordApprovalRequested(pending(id));
    expect(h.notified).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.notified).toEqual([
      expect.objectContaining({
        type: 'connector.approval_required',
        dedupeKey: 'connector.approval_required:a1',
        title: 'Approval needed',
        body: 'Google Calendar (clhuffine@gmail.com). Delete event × 3',
        url: `/?session=${CHAT}`,
      }),
    ]);
  });
});

describe('recordApprovalDecision', () => {
  it('records the decision in the chat and tells the waiting agent to retry', async () => {
    await recordApprovalDecision([resolved(pending('a1'), 'approve'), resolved(pending('a2'), 'approve')], 'approve');

    expect(h.inserted).toEqual([
      expect.objectContaining({
        sessionId: CHAT,
        source: 'approval_response',
        content: 'Approved: Delete event × 2',
        toolIsError: false,
        toolInput: expect.objectContaining({ outcome: 'approve', approvalIds: ['a1', 'a2'] }),
      }),
    ]);
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]!.sessionId).toBe(CHAT);
    expect(h.dispatched[0]!.text).toContain('The user approved 2 pending google_calendar__delete_event calls');
    expect(h.dispatched[0]!.text).toContain('"eventId":"evt-a1"');
  });

  it('records a denial and tells the agent to stand down', async () => {
    await recordApprovalDecision([resolved(pending('a1'), 'deny')], 'deny');
    expect(h.inserted[0]).toMatchObject({ content: 'Denied: Delete event', toolIsError: true });
    expect(h.dispatched[0]!.text).toContain('Do not retry it.');
  });

  it('records but does not dispatch into a chat that cannot take a turn', async () => {
    h.sessions.set(CHAT, { ...h.sessions.get(CHAT), status: 'archived' });
    await recordApprovalDecision([resolved(pending('a1'), 'approve')], 'approve');
    expect(h.inserted).toHaveLength(1);
    expect(h.dispatched).toEqual([]);
  });

  it('writes one row per kind and one note per chat', async () => {
    h.sessions.set('chat-2', { id: 'chat-2', status: 'active', executionId: 'exec-2', surfaceKind: null, externalSessionId: null });
    await recordApprovalDecision(
      [
        resolved(pending('a1'), 'always'),
        resolved(pending('a2', { connectionId: 'conn-2', account: 'work@example.com' }), 'always'),
        resolved(pending('a3', { sessionId: 'chat-2' }), 'always'),
        resolved(pending('a4', { sessionId: null }), 'always'),
      ],
      'always',
    );
    expect(h.inserted.map((r) => [r.sessionId, (r.toolInput as { approvalIds: string[] }).approvalIds])).toEqual([
      [CHAT, ['a1']],
      [CHAT, ['a2']],
      ['chat-2', ['a3']],
    ]);
    expect(h.dispatched.map((d) => [d.sessionId, d.executionId])).toEqual([
      [CHAT, null],
      ['chat-2', 'exec-2'],
    ]);
    expect(h.dispatched[0]!.text).toContain('(account clhuffine@gmail.com)');
    expect(h.dispatched[0]!.text).toContain('(account work@example.com)');
  });
});

describe('recordApprovalsSettled', () => {
  it('records how a moot request settled, without waking the agent', async () => {
    await recordApprovalsSettled([pending('a1')]);
    expect(h.inserted[0]).toMatchObject({
      source: 'approval_response',
      content: 'Ran under your current settings: Delete event',
      toolInput: expect.objectContaining({ outcome: 'settled', approvalIds: ['a1'] }),
    });
    expect(h.dispatched).toEqual([]);
  });
});

describe('allowWithoutAsking', () => {
  const dirs: string[] = [];
  const prev = process.env.RI_CONFIG_DIR;
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-events-'));
    dirs.push(dir);
    process.env.RI_CONFIG_DIR = dir;
  });
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    if (prev === undefined) delete process.env.RI_CONFIG_DIR;
    else process.env.RI_CONFIG_DIR = prev;
  });

  it('turns Ask first off through the write-policy override the settings screen uses', async () => {
    await allowWithoutAsking('google_calendar.delete_event', 'high');
    expect(getActionOverride('google_calendar.delete_event')).toBe('auto');
  });

  it('clears an override instead of pinning the default, like the settings switch', async () => {
    // A normally-auto write the user had gated: allowing it again restores the default.
    setActionOverride('google_calendar.create_event', 'ask');
    await allowWithoutAsking('google_calendar.create_event', 'medium');
    expect(getActionOverride('google_calendar.create_event')).toBeUndefined();
  });

  it('flips an MCP tool’s own Ask first switch and re-ingests', async () => {
    h.mcpEntries.push({ id: 'srv-1', slug: 'linear', toolOverrides: { other_tool: { enabled: false } } });
    await allowWithoutAsking('mcp.linear.create_issue', 'high');
    expect(h.mcpUpdates).toEqual([
      {
        id: 'srv-1',
        patch: { toolOverrides: { other_tool: { enabled: false }, create_issue: { mutating: false } } },
      },
    ]);
    expect(h.invalidated).toBe(1);
    expect(getActionOverride('mcp.linear.create_issue')).toBeUndefined();
  });

  it('refuses when the MCP server is gone', async () => {
    await expect(allowWithoutAsking('mcp.gone.tool', 'high')).rejects.toThrow('no longer configured');
  });
});
