import { describe, expect, it } from 'vitest';
import { collectNestedEvents, isSubagentEvent, partitionSubagentEvents } from './subagent';

interface Row {
  id: string;
  source: string;
  toolName: string | null;
  externalToolCallId: string | null;
  externalParentToolCallId: string | null;
}

/** A nested event belonging to `parent`. */
const row = (id: string, parent: string | null = null): Row => ({
  id,
  source: 'agent',
  toolName: null,
  externalToolCallId: null,
  externalParentToolCallId: parent,
});

/** An `Agent` tool_call row — the only kind that anchors a nested group. */
const launch = (id: string, callId: string, parent: string | null = null): Row => ({
  id,
  source: 'tool_call',
  toolName: 'Agent',
  externalToolCallId: callId,
  externalParentToolCallId: parent,
});

/** A non-subagent tool call, e.g. `Skill` — must NOT anchor nesting. */
const plainCall = (id: string, callId: string, toolName = 'Skill'): Row => ({
  id,
  source: 'tool_call',
  toolName,
  externalToolCallId: callId,
  externalParentToolCallId: null,
});

const ids = (rows: Row[] | undefined) => (rows ?? []).map((r) => r.id);

describe('isSubagentEvent', () => {
  it('is false for events the session itself produced', () => {
    expect(isSubagentEvent(row('a'))).toBe(false);
  });

  it('is true once a parent tool call owns the event', () => {
    expect(isSubagentEvent(row('a', 'toolu_1'))).toBe(true);
  });

  it('treats an empty string as unattributed rather than a real parent', () => {
    // A blank tag would otherwise create a subagent keyed by '' that no tool
    // call can ever claim, stranding its events out of the transcript.
    expect(isSubagentEvent({ externalParentToolCallId: '' })).toBe(false);
  });
});

describe('partitionSubagentEvents', () => {
  it('keeps untagged events at the top level in order', () => {
    const { topLevel, byParentCallId } = partitionSubagentEvents([
      row('a'),
      row('b'),
      row('c'),
    ]);
    expect(ids(topLevel)).toEqual(['a', 'b', 'c']);
    expect(byParentCallId.size).toBe(0);
  });

  it('routes tagged events to their launching call and out of the top level', () => {
    const { topLevel, byParentCallId } = partitionSubagentEvents([
      launch('launch', 'toolu_1'),
      row('kid1', 'toolu_1'),
      row('kid2', 'toolu_1'),
      row('reply'),
    ]);
    expect(ids(topLevel)).toEqual(['launch', 'reply']);
    expect(ids(byParentCallId.get('toolu_1'))).toEqual(['kid1', 'kid2']);
  });

  it('separates concurrent subagents and preserves each stream order', () => {
    // The real failure mode: four research subagents interleaving on one
    // parent stream. Each must reassemble as its own transcript.
    const { topLevel, byParentCallId } = partitionSubagentEvents([
      launch('la', 'toolu_a'),
      launch('lb', 'toolu_b'),
      row('a1', 'toolu_a'),
      row('b1', 'toolu_b'),
      row('a2', 'toolu_a'),
      row('b2', 'toolu_b'),
      row('a3', 'toolu_a'),
    ]);
    expect(ids(topLevel)).toEqual(['la', 'lb']);
    expect(ids(byParentCallId.get('toolu_a'))).toEqual(['a1', 'a2', 'a3']);
    expect(ids(byParentCallId.get('toolu_b'))).toEqual(['b1', 'b2']);
  });

  it('keys a nested subagent off its immediate parent, not the outermost launch', () => {
    // Depth 2: the inner launch is itself a child of toolu_outer, and the
    // grandchild's events hang off the inner call. Flattening every
    // descendant onto toolu_outer would lose the tree.
    const { byParentCallId } = partitionSubagentEvents([
      launch('outer-launch', 'toolu_outer'),
      launch('inner-launch', 'toolu_inner', 'toolu_outer'),
      row('grandchild', 'toolu_inner'),
    ]);
    expect(ids(byParentCallId.get('toolu_outer'))).toEqual(['inner-launch']);
    expect(ids(byParentCallId.get('toolu_inner'))).toEqual(['grandchild']);
  });

  it('does not mutate or reorder the input', () => {
    const input = [launch('a', 'toolu_1'), row('b', 'toolu_1')];
    const snapshot = [...input];
    partitionSubagentEvents(input);
    expect(input).toEqual(snapshot);
  });
});

describe('partitionSubagentEvents anchor rule', () => {
  it('keeps nested events inline when their launch row is not loaded', () => {
    // The transcript paginates. A page can hold subagent events whose `Agent`
    // launch row sits on an older page — measured at 61 events on a real
    // session. Nesting renders inside the launch row, so with no anchor there
    // is nowhere to draw them and they would disappear entirely.
    const { topLevel, byParentCallId } = partitionSubagentEvents([
      row('orphan1', 'toolu_offpage'),
      row('orphan2', 'toolu_offpage'),
      row('reply'),
    ]);
    expect(ids(topLevel)).toEqual(['orphan1', 'orphan2', 'reply']);
    expect(byParentCallId.size).toBe(0);
  });

  it('re-nests them once the launch row is loaded', () => {
    const { topLevel, byParentCallId } = partitionSubagentEvents([
      launch('launch', 'toolu_offpage'),
      row('orphan1', 'toolu_offpage'),
      row('orphan2', 'toolu_offpage'),
      row('reply'),
    ]);
    expect(ids(topLevel)).toEqual(['launch', 'reply']);
    expect(ids(byParentCallId.get('toolu_offpage'))).toEqual(['orphan1', 'orphan2']);
  });

  it('nests anchored groups while leaving un-anchored ones inline', () => {
    const { topLevel, byParentCallId } = partitionSubagentEvents([
      row('orphan', 'toolu_offpage'),
      launch('launch', 'toolu_here'),
      row('kid', 'toolu_here'),
    ]);
    expect(ids(topLevel)).toEqual(['orphan', 'launch']);
    expect(ids(byParentCallId.get('toolu_here'))).toEqual(['kid']);
  });

  it('never loses an event, whatever the anchor situation', () => {
    const input = [
      row('orphan', 'toolu_gone'),
      launch('launch', 'toolu_here'),
      row('kid', 'toolu_here'),
      row('reply'),
    ];
    const { topLevel, byParentCallId } = partitionSubagentEvents(input);
    const rendered = [...topLevel, ...[...byParentCallId.values()].flat()];
    expect(rendered.length).toBe(input.length);
    expect(new Set(ids(rendered))).toEqual(new Set(ids(input)));
  });

  it('keeps a self-referencing tool call in the main flow', () => {
    // A row claiming itself as its own parent would be nested inside the very
    // row that renders it — the structure can only be drawn by recursing
    // forever. It stays inline instead.
    const selfRef = launch('self', 'toolu_x', 'toolu_x');
    const { topLevel, byParentCallId } = partitionSubagentEvents([selfRef]);
    expect(ids(topLevel)).toEqual(['self']);
    expect(byParentCallId.size).toBe(0);
  });

  it('still nests that call\'s legitimate children', () => {
    // Dropping the self-edge must not orphan real children of the same call.
    const { topLevel, byParentCallId } = partitionSubagentEvents([
      launch('self', 'toolu_x', 'toolu_x'),
      row('kid', 'toolu_x'),
    ]);
    expect(ids(topLevel)).toEqual(['self']);
    expect(ids(byParentCallId.get('toolu_x'))).toEqual(['kid']);
  });

});

describe('only subagent launches anchor nesting', () => {
  it('leaves a Skill\'s nested tool calls in the main flow', () => {
    // `parentToolCallId` is not a subagent marker — Claude sets it on
    // anything nested under any tool call. A Skill's tool calls are the
    // session's own work, just scoped. Folding them away hid up to 74 shell
    // commands behind a disclosure while the group header said "1 tool call".
    const { topLevel, byParentCallId } = partitionSubagentEvents([
      plainCall('skill', 'toolu_skill'),
      row('shell1', 'toolu_skill'),
      row('shell2', 'toolu_skill'),
    ]);
    expect(ids(topLevel)).toEqual(['skill', 'shell1', 'shell2']);
    expect(byParentCallId.size).toBe(0);
  });

  it('nests an Agent while leaving a Skill inline in the same turn', () => {
    const { topLevel, byParentCallId } = partitionSubagentEvents([
      plainCall('skill', 'toolu_skill'),
      row('shell', 'toolu_skill'),
      launch('agent', 'toolu_agent'),
      row('kid', 'toolu_agent'),
    ]);
    expect(ids(topLevel)).toEqual(['skill', 'shell', 'agent']);
    expect(ids(byParentCallId.get('toolu_agent'))).toEqual(['kid']);
  });

  it('does not treat a Bash progress heartbeat as nested work', () => {
    const { topLevel, byParentCallId } = partitionSubagentEvents([
      plainCall('bash', 'toolu_bash', 'Bash'),
      { ...row('beat', 'toolu_bash'), source: 'system' },
    ]);
    expect(ids(topLevel)).toEqual(['bash', 'beat']);
    expect(byParentCallId.size).toBe(0);
  });
});

describe('unreachable anchors', () => {
  it('keeps a mutually-referencing pair of launches visible', () => {
    // A cycle: neither launch can render inside the other, so both must stay
    // in the main flow rather than pointing at each other into oblivion.
    const a = launch('a', 'toolu_a', 'toolu_b');
    const b = launch('b', 'toolu_b', 'toolu_a');
    const { topLevel, byParentCallId } = partitionSubagentEvents([a, b]);
    expect(ids(topLevel).sort()).toEqual(['a', 'b']);
    expect(byParentCallId.size).toBe(0);
  });

  it('keeps children of an unreachable launch visible too', () => {
    const { topLevel } = partitionSubagentEvents([
      launch('a', 'toolu_a', 'toolu_b'),
      launch('b', 'toolu_b', 'toolu_a'),
      row('kid', 'toolu_a'),
    ]);
    expect(ids(topLevel).sort()).toEqual(['a', 'b', 'kid']);
  });

  it('nests a legitimately reachable depth-2 chain', () => {
    const { topLevel, byParentCallId } = partitionSubagentEvents([
      launch('outer', 'toolu_outer'),
      launch('inner', 'toolu_inner', 'toolu_outer'),
      row('grandchild', 'toolu_inner'),
    ]);
    expect(ids(topLevel)).toEqual(['outer']);
    expect(ids(byParentCallId.get('toolu_outer'))).toEqual(['inner']);
    expect(ids(byParentCallId.get('toolu_inner'))).toEqual(['grandchild']);
  });
});

describe('collectNestedEvents', () => {
  it('walks the whole subtree, not just immediate children', () => {
    const { byParentCallId } = partitionSubagentEvents([
      launch('outer', 'toolu_outer'),
      launch('inner', 'toolu_inner', 'toolu_outer'),
      row('grandchild', 'toolu_inner'),
    ]);
    expect(ids(collectNestedEvents('toolu_outer', byParentCallId))).toEqual([
      'inner',
      'grandchild',
    ]);
  });

  it('terminates on a cyclic map instead of recursing forever', () => {
    const cyclic = new Map<string, Row[]>([
      ['toolu_a', [launch('b', 'toolu_b', 'toolu_a')]],
      ['toolu_b', [launch('a', 'toolu_a', 'toolu_b')]],
    ]);
    expect(ids(collectNestedEvents('toolu_a', cyclic)).sort()).toEqual(['a', 'b']);
  });

  it('returns nothing for a call with no nested work', () => {
    expect(collectNestedEvents('toolu_none', new Map())).toEqual([]);
  });
});
