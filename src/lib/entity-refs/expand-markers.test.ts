import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspaces = new Map<string, { id: string; name: string; status: string; purpose: string | null }>();
vi.mock('@/lib/db/queries', () => ({
  getTask: (id: string) => (id === 't1' ? { id, title: 'Fix deploy', status: 'todo', description: null, body: null } : undefined),
  getNote: () => undefined,
  getChatSession: () => undefined,
  getWorkspace: (id: string) => workspaces.get(id),
}));

const { expandEntityMarkers } = await import('./expand-markers');

/**
 * What a chat receives for an `@agent` mention: enough to know who was
 * meant and how to reach it (docs/agent-coordination.md), never its folder.
 */
describe('expandEntityMarkers for agents', () => {
  beforeEach(() => {
    workspaces.clear();
    workspaces.set('ws-ri', { id: 'ws-ri', name: 'Ri', status: 'active', purpose: '  Builds the Ri app.  ' });
    workspaces.set('ws-bare', { id: 'ws-bare', name: 'Notes "&" <drafts>', status: 'active', purpose: null });
    workspaces.set('ws-old', { id: 'ws-old', name: 'Old site', status: 'archived', purpose: 'The 2024 site.' });
  });

  it('names the agent, gives its coordination address, and says what it is for', () => {
    expect(expandEntityMarkers('Ask [[agent:ws-ri]] why the build fails', 'chat-1')).toBe(
      'Ask <agent id="ws-ri" name="Ri" address="agent:ws-ri">\nBuilds the Ri app.\n</agent> why the build fails',
    );
  });

  it('closes the tag when the agent has no purpose, escaping its name', () => {
    expect(expandEntityMarkers('[[agent:ws-bare]]', 'chat-1')).toBe(
      '<agent id="ws-bare" name="Notes &quot;&amp;&quot; &lt;drafts>" address="agent:ws-bare" />',
    );
  });

  it('says an archived agent is archived, since a send to it is refused', () => {
    expect(expandEntityMarkers('[[agent:ws-old]]', 'chat-1')).toBe(
      '<agent id="ws-old" name="Old site" address="agent:ws-old" status="archived">\nThe 2024 site.\n</agent>',
    );
  });

  it('leaves an unknown agent as its marker, beside the other kinds', () => {
    expect(expandEntityMarkers('[[agent:ws-gone]] and [[task:t1]]', 'chat-1')).toBe(
      '[[agent:ws-gone]] and <task id="t1" title="Fix deploy" status="todo" />',
    );
  });
});
