import { describe, it, expect } from 'vitest';
import type { ChatEventRecord } from '@/db/types';
import { buildTranscriptNodes, summarizeCounts, formatSpan, type TranscriptNode } from './transcript-grouping';

let seq = 0;
function ev(source: string, extra: Partial<ChatEventRecord> = {}): ChatEventRecord {
  seq++;
  return {
    id: `e${seq}`,
    source,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    content: null,
    toolName: null,
    ...extra,
  } as ChatEventRecord;
}

const kinds = (nodes: TranscriptNode[]) => nodes.map((n) => (n.kind === 'event' ? n.event.source : n.kind));

describe('buildTranscriptNodes', () => {
  it('full density returns one node per event', () => {
    const events = [ev('user'), ev('thinking', { content: 'x' }), ev('tool_call'), ev('agent', { content: 'hi' })];
    const nodes = buildTranscriptNodes(events, { isRunning: false, density: 'full' });
    expect(nodes.every((n) => n.kind === 'event')).toBe(true);
    expect(nodes).toHaveLength(4);
  });

  it('condensed folds a completed turn, keeping the user msg and final reply visible', () => {
    const events = [
      ev('user'),
      ev('thinking', { content: 'reasoning' }),
      ev('tool_call', { toolName: 'Read' }),
      ev('tool_result'),
      ev('agent', { content: 'final reply' }),
    ];
    const nodes = buildTranscriptNodes(events, { isRunning: false, density: 'condensed' });
    expect(kinds(nodes)).toEqual(['user', 'group', 'agent']);
    const group = nodes.find((n) => n.kind === 'group');
    expect(group?.kind === 'group' && group.events).toHaveLength(3);
  });

  it('collapses intermediate assistant messages but keeps the last one visible', () => {
    const events = [
      ev('user'),
      ev('agent', { content: 'intermediate' }),
      ev('tool_call', { toolName: 'Bash' }),
      ev('agent', { content: 'final' }),
    ];
    const nodes = buildTranscriptNodes(events, { isRunning: false, density: 'condensed' });
    expect(kinds(nodes)).toEqual(['user', 'group', 'agent']);
    const group = nodes.find((n) => n.kind === 'group');
    // intermediate agent + tool_call collapse → 1 message, 1 tool call
    expect(group?.kind === 'group' && group.counts).toMatchObject({ messages: 1, toolCalls: 1 });
  });

  it('leaves the live (running) last turn inline', () => {
    const events = [ev('user'), ev('thinking', { content: 'r' }), ev('tool_call', { toolName: 'Read' })];
    const nodes = buildTranscriptNodes(events, { isRunning: true, density: 'condensed' });
    expect(kinds(nodes)).toEqual(['user', 'thinking', 'tool_call']);
  });

  it('does not create a group for a turn with no foldable activity', () => {
    const events = [ev('user'), ev('agent', { content: 'just a reply' })];
    const nodes = buildTranscriptNodes(events, { isRunning: false, density: 'condensed' });
    expect(kinds(nodes)).toEqual(['user', 'agent']);
  });

  it('counts subagents (Task) separately from tool calls', () => {
    const events = [
      ev('user'),
      ev('tool_call', { toolName: 'Task' }),
      ev('tool_call', { toolName: 'Read' }),
      ev('agent', { content: 'done' }),
    ];
    const nodes = buildTranscriptNodes(events, { isRunning: false, density: 'condensed' });
    const group = nodes.find((n) => n.kind === 'group');
    expect(group?.kind === 'group' && group.counts).toMatchObject({ subagents: 1, toolCalls: 1 });
  });

  it('keeps actionable rows (e.g. auth_required) visible, not folded', () => {
    const events = [
      ev('user'),
      ev('tool_call', { toolName: 'Read' }),
      ev('auth_required'),
    ];
    const nodes = buildTranscriptNodes(events, { isRunning: false, density: 'condensed' });
    expect(kinds(nodes)).toEqual(['user', 'group', 'auth_required']);
  });
});

describe('summarizeCounts', () => {
  it('joins non-zero parts with middots and pluralizes', () => {
    expect(summarizeCounts({ toolCalls: 6, thinking: 4, messages: 0, subagents: 2, results: 9 })).toBe(
      '6 tool calls · 2 subagents · 4 thinking blocks',
    );
    expect(summarizeCounts({ toolCalls: 1, thinking: 0, messages: 0, subagents: 0, results: 0 })).toBe('1 tool call');
  });
});

describe('formatSpan', () => {
  it('formats sub-minute and multi-minute spans', () => {
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(formatSpan(new Date(base).toISOString(), new Date(base + 7400).toISOString())).toBe('7.4s');
    expect(formatSpan(new Date(base).toISOString(), new Date(base + 134000).toISOString())).toBe('2m 14s');
    expect(formatSpan(new Date(base).toISOString(), new Date(base + 200).toISOString())).toBeNull();
  });
});

describe('nested subagent work in turn aggregates', () => {
  const launch = (callId: string) =>
    ev('tool_call', { toolName: 'Agent', externalToolCallId: callId });
  const edit = (path: string, content: string, parent: string | null = null) =>
    ev('tool_call', {
      toolName: 'Write',
      toolInput: { file_path: path, content },
      externalParentToolCallId: parent,
    });

  it('counts files a subagent wrote in the turn footer', () => {
    // The footer's contract is "what changed on disk this turn". A child
    // process doing the writing does not make the file not-changed — and
    // counting only top-level rows dropped 152 of 272 paths on a real session.
    const nested = new Map([['toolu_a', [edit('/src/child.ts', 'a\nb\n', 'toolu_a')]]]);
    const nodes = buildTranscriptNodes(
      [ev('user'), launch('toolu_a'), ev('agent', { content: 'done' })],
      { isRunning: false, density: 'condensed', nestedByParentCallId: nested },
    );
    const files = nodes.find((n) => n.kind === 'files');
    expect(files?.kind === 'files' && files.files.map((f) => f.path)).toEqual([
      '/src/child.ts',
    ]);
  });

  it('renders a footer for a turn where only the subagent wrote', () => {
    // Previously this turn produced no footer at all.
    const nested = new Map([['toolu_a', [edit('/src/only.ts', 'x\n', 'toolu_a')]]]);
    const nodes = buildTranscriptNodes([ev('user'), launch('toolu_a')], {
      isRunning: false,
      density: 'condensed',
      nestedByParentCallId: nested,
    });
    expect(nodes.some((n) => n.kind === 'files')).toBe(true);
  });

  it('merges a path both the main agent and its subagent touched', () => {
    // One line from the subagent, two from the main agent, one merged entry.
    const nested = new Map([['toolu_a', [edit('/src/shared.ts', 'a', 'toolu_a')]]]);
    const nodes = buildTranscriptNodes(
      [ev('user'), launch('toolu_a'), edit('/src/shared.ts', 'b\nc')],
      { isRunning: false, density: 'condensed', nestedByParentCallId: nested },
    );
    const files = nodes.find((n) => n.kind === 'files');
    expect(files?.kind === 'files' && files.files).toHaveLength(1);
    expect(files?.kind === 'files' && files.files[0].additions).toBe(3);
  });

  it('reaches files written by a grandchild subagent', () => {
    const nested = new Map([
      ['toolu_outer', [ev('tool_call', {
        toolName: 'Agent',
        externalToolCallId: 'toolu_inner',
        externalParentToolCallId: 'toolu_outer',
      })]],
      ['toolu_inner', [edit('/src/deep.ts', 'z\n', 'toolu_inner')]],
    ]);
    const nodes = buildTranscriptNodes([ev('user'), launch('toolu_outer')], {
      isRunning: false,
      density: 'condensed',
      nestedByParentCallId: nested,
    });
    const files = nodes.find((n) => n.kind === 'files');
    expect(files?.kind === 'files' && files.files.map((f) => f.path)).toEqual([
      '/src/deep.ts',
    ]);
  });

  it('omits the footer when nothing was written anywhere', () => {
    const nodes = buildTranscriptNodes([ev('user'), launch('toolu_a')], {
      isRunning: false,
      density: 'condensed',
      nestedByParentCallId: new Map(),
    });
    expect(nodes.some((n) => n.kind === 'files')).toBe(false);
  });

  it('never promotes an un-anchored subagent line to the turn reply', () => {
    // When the launch row is on a page that has not loaded, the subagent's
    // events stay inline. They still must not become the visible answer —
    // that is the churn this whole change exists to remove.
    const nodes = buildTranscriptNodes(
      [
        ev('user'),
        ev('agent', { content: 'the real reply' }),
        ev('tool_call', { toolName: 'Read' }),
        ev('agent', { content: 'subagent narration', externalParentToolCallId: 'toolu_gone' }),
      ],
      { isRunning: false, density: 'condensed' },
    );
    const visible = nodes.filter((n) => n.kind === 'event' && n.event.source === 'agent');
    expect(visible).toHaveLength(1);
    expect(visible[0].kind === 'event' && visible[0].event.content).toBe('the real reply');
  });
});
