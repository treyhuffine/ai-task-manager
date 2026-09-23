import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_VIEW_MODE, parseAgentViewMode } from './agent-view-mode';

/** The agent-view trial preference (docs/agents-view-spec.md Phase 7). */
describe('parseAgentViewMode', () => {
  it('defaults to opening the agent view, and narrows anything unknown to the default', () => {
    expect(DEFAULT_AGENT_VIEW_MODE).toBe('view');
    expect(parseAgentViewMode('fold')).toBe('fold');
    expect(parseAgentViewMode('view')).toBe('view');
    for (const raw of [null, undefined, '', 'agent', 42]) expect(parseAgentViewMode(raw)).toBe('view');
  });
});
