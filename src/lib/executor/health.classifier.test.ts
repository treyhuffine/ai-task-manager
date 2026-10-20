import { describe, it, expect } from 'vitest';
import { _internals, SEND_REFUSED_SUBTYPE } from './health';
import type { ChatEventRecord } from '@/db/types';

/**
 * Targets the pure activity-probe logic — orphan detection and
 * recent-agent-event window. Avoids spinning up DB / reconcile /
 * adapter state so the test stays cheap and the assertions are
 * about the classifier rules, not the full system.
 */

const { inspectActivity, RECENT_ACTIVITY_MS } = _internals;

function row(
  partial: Partial<ChatEventRecord> & Pick<ChatEventRecord, 'role' | 'source' | 'createdAt'>,
): ChatEventRecord {
  return {
    id: 'r',
    sessionId: 's',
    senderSessionId: null,
    authorMemberId: null,
    updatedAt: partial.createdAt,
    content: null,
    toolName: null,
    toolInput: null,
    toolIsError: null,
    toolExitCode: null,
    raw: null,
    externalEventId: null,
    externalMessageId: null,
    externalTurnId: null,
    externalToolCallId: null,
    externalParentToolCallId: null,
    sourcePartIndex: 0,
    partRevision: null,
    attachments: [],
    ...partial,
  };
}

const recent = () => new Date().toISOString();
const stale = () => new Date(Date.now() - RECENT_ACTIVITY_MS - 60_000).toISOString();

describe('inspectActivity', () => {
  it('treats a recent assistant event as active', () => {
    const events = [row({ role: 'assistant', source: 'agent', createdAt: recent() })];
    expect(inspectActivity(events).hasRecentAgentEvent).toBe(true);
  });

  it('treats a recent tool_call as active', () => {
    const events = [row({ role: 'assistant', source: 'tool_call', createdAt: recent() })];
    expect(inspectActivity(events).hasRecentAgentEvent).toBe(true);
  });

  it('does not count stale agent events as active', () => {
    const events = [row({ role: 'assistant', source: 'agent', createdAt: stale() })];
    expect(inspectActivity(events).hasRecentAgentEvent).toBe(false);
  });

  it('flags an orphan when the latest event is a user message', () => {
    const events = [
      // DESC order — newest first.
      row({ id: 'u', role: 'user', source: 'user', createdAt: recent() }),
      row({ role: 'system', source: 'result', createdAt: stale() }),
    ];
    const probe = inspectActivity(events);
    expect(probe.orphan?.id).toBe('u');
  });

  it('flags an orphan when the latest event is a permission_response', () => {
    const events = [
      row({ id: 'p', role: 'system', source: 'permission_response', createdAt: recent() }),
      row({ role: 'tool', source: 'tool_result', createdAt: stale() }),
    ];
    const probe = inspectActivity(events);
    expect(probe.orphan?.id).toBe('p');
  });

  it('does not flag an orphan when the agent is currently working', () => {
    const events = [
      // Newest: agent activity AFTER the user message. Mid-turn send,
      // not an orphan.
      row({ role: 'assistant', source: 'tool_call', createdAt: recent() }),
      row({ role: 'user', source: 'user', createdAt: stale() }),
    ];
    const probe = inspectActivity(events);
    expect(probe.orphan).toBeNull();
  });

  it('does not flag a session that ended cleanly as an orphan', () => {
    const events = [
      row({ role: 'system', source: 'result', createdAt: recent() }),
      row({ role: 'assistant', source: 'agent', createdAt: stale() }),
      row({ role: 'user', source: 'user', createdAt: stale() }),
    ];
    const probe = inspectActivity(events);
    expect(probe.orphan).toBeNull();
  });

  it('returns empty probe on no events', () => {
    const probe = inspectActivity([]);
    expect(probe.hasRecentAgentEvent).toBe(false);
    expect(probe.orphan).toBeNull();
  });

  // The classifier should still flag a stalled permission_response as
  // an orphan candidate; the redispatch path (in healthCheckSession,
  // not in inspectActivity) is what filters it out. Locking the
  // boundary in case someone is tempted to "simplify" by suppressing
  // detection here too.
  it('keeps permission_response detection separate from user-source check', () => {
    const events = [
      row({ id: 'pr', role: 'system', source: 'permission_response', createdAt: stale() }),
    ];
    const probe = inspectActivity(events);
    expect(probe.orphan?.id).toBe('pr');
    expect(probe.orphan?.source).toBe('permission_response');
  });

  // A message the chat already said wasn't sent must never be sent later by
  // orphan recovery when the chat opens.
  it('treats a refused message as final, not an orphan', () => {
    const refused = [
      row({ role: 'system', source: 'error', content: "This message wasn't sent: its app context is no longer available", raw: { subtype: SEND_REFUSED_SUBTYPE, messageId: 'u' }, createdAt: recent() }),
      row({ id: 'u', role: 'user', source: 'user', createdAt: stale() }),
    ];
    expect(inspectActivity(refused).orphan).toBeNull();
    // An ordinary error after a message (a harness failure mid-turn) still leaves it an orphan.
    const failed = [
      row({ role: 'system', source: 'error', content: 'The harness exited', createdAt: recent() }),
      row({ id: 'u', role: 'user', source: 'user', createdAt: stale() }),
    ];
    expect(inspectActivity(failed).orphan?.id).toBe('u');
    // A newer message after a refused one is that newer message's to recover.
    expect(inspectActivity([row({ id: 'u2', role: 'user', source: 'user', createdAt: recent() }), ...refused]).orphan?.id).toBe('u2');
  });
});

