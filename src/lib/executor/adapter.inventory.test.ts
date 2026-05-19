import { describe, it, expect, beforeEach } from 'vitest';
import {
  _recordSessionInventory,
  _resetExecutorState,
  getSessionInventory,
} from './adapter';
import type { StreamEvent } from '@agentex/agent';

/**
 * Verify the inventory lifecycle: capture from system/init, first-wins
 * semantics so a mid-session re-handshake doesn't clobber the original,
 * non-init events are ignored, and reset clears state.
 *
 * Tests `_recordSessionInventory` directly rather than through
 * `provider.createSession` → `onEvent`, since the full createSession
 * path drags in DB queries, the event writer, realtime pub/sub, and
 * pending-input plumbing — none of which adds signal to the inventory
 * lifecycle assertions. The helper is the test seam.
 */

const SESSION_ID = 'test-session-1';

// The helper only reads `event.type`, `event.subtype`, `event.slashCommands`,
// `event.skills`, `event.providerType`, `event.sessionId`, and `event.raw`.
// Skip the rest of BaseStreamEventFields — double-cast through unknown so
// the structural type check doesn't bark about missing telemetry fields.
function makeInitEvent(slashCommands: string[], skills: string[]): StreamEvent {
  return {
    type: 'system',
    subtype: 'init',
    providerType: 'claude',
    sessionId: 'claude-session-abc',
    model: 'sonnet',
    cwd: '/tmp/test',
    tools: null,
    permissionMode: null,
    slashCommands,
    skills,
    raw: { slash_commands: slashCommands, skills },
  } as unknown as StreamEvent;
}

function makeAssistantEvent(text: string): StreamEvent {
  return { type: 'assistant', text } as unknown as StreamEvent;
}

describe('executor adapter — inventory lifecycle', () => {
  beforeEach(() => {
    _resetExecutorState();
  });

  it('returns null before any event is recorded', () => {
    expect(getSessionInventory(SESSION_ID)).toBeNull();
  });

  it('captures the inventory from a system/init event', () => {
    _recordSessionInventory(SESSION_ID, makeInitEvent(['/clear', '/help'], ['orchestrator']));

    const inventory = getSessionInventory(SESSION_ID);
    expect(inventory).not.toBeNull();
    expect(inventory?.slashCommands).toEqual(['/clear', '/help']);
    expect(inventory?.skills).toEqual(['orchestrator']);
    expect(inventory?.source).toBe('provider-init');
    expect(inventory?.provider).toBe('claude');
  });

  it('keeps the first inventory and ignores subsequent init events', () => {
    _recordSessionInventory(SESSION_ID, makeInitEvent([], ['first']));
    _recordSessionInventory(SESSION_ID, makeInitEvent([], ['second-should-be-ignored']));

    const inventory = getSessionInventory(SESSION_ID);
    expect(inventory?.skills).toEqual(['first']);
  });

  it('ignores non-init events', () => {
    _recordSessionInventory(SESSION_ID, makeAssistantEvent('hello'));
    expect(getSessionInventory(SESSION_ID)).toBeNull();
  });

  it('ignores init events with empty inventory arrays', () => {
    // commandInventoryFromEvent returns null when both arrays are empty —
    // there's no useful state to record. The capture should be a no-op,
    // not a `{ slashCommands: [], skills: [] }` stub.
    _recordSessionInventory(SESSION_ID, makeInitEvent([], []));
    expect(getSessionInventory(SESSION_ID)).toBeNull();
  });

  it('keeps inventories per session independently', () => {
    const otherId = 'test-session-2';
    _recordSessionInventory(SESSION_ID, makeInitEvent([], ['a']));
    _recordSessionInventory(otherId, makeInitEvent([], ['b']));

    expect(getSessionInventory(SESSION_ID)?.skills).toEqual(['a']);
    expect(getSessionInventory(otherId)?.skills).toEqual(['b']);
  });

  it('reset clears all captured inventories', () => {
    _recordSessionInventory(SESSION_ID, makeInitEvent([], ['orchestrator']));
    expect(getSessionInventory(SESSION_ID)).not.toBeNull();

    _resetExecutorState();
    expect(getSessionInventory(SESSION_ID)).toBeNull();
  });

  it('allows re-capture after reset (proves cleanup released the map)', () => {
    _recordSessionInventory(SESSION_ID, makeInitEvent([], ['first']));
    _resetExecutorState();
    _recordSessionInventory(SESSION_ID, makeInitEvent([], ['fresh']));

    expect(getSessionInventory(SESSION_ID)?.skills).toEqual(['fresh']);
  });
});
