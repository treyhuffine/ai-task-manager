import { describe, expect, it } from 'vitest';
import {
  mobileTabForView,
  HOME_VIEW,
  activeAgentIdOf,
  activeSessionIdOf,
  agentView,
  applyViewToSearchParams,
  executionView,
  isAgentTab,
  sameView,
  viewFromSearchParams,
  viewKey,
} from './active-view';

/** The dashboard's active view and its URL encoding (docs/agents-view-spec.md Phase 7). */

const params = (qs: string) => new URLSearchParams(qs);

describe('viewFromSearchParams', () => {
  it('reads Home, an agent with or without a tab, and an execution', () => {
    expect(viewFromSearchParams(params(''))).toEqual(HOME_VIEW);
    expect(viewFromSearchParams(params('agent=ws-1'))).toEqual({ kind: 'agent', id: 'ws-1' });
    expect(viewFromSearchParams(params('agent=ws-1&tab=files'))).toEqual({ kind: 'agent', id: 'ws-1', tab: 'files' });
    expect(viewFromSearchParams(params('session=s-1'))).toEqual({ kind: 'execution', id: 's-1' });
  });

  it('drops an unknown tab rather than trusting it', () => {
    expect(viewFromSearchParams(params('agent=ws-1&tab=nope'))).toEqual({ kind: 'agent', id: 'ws-1' });
  });

  it('lets session win when a URL carries both', () => {
    expect(viewFromSearchParams(params('agent=ws-1&session=s-1'))).toEqual({ kind: 'execution', id: 's-1' });
  });
});

describe('applyViewToSearchParams', () => {
  it('round-trips every view and keeps unrelated params', () => {
    for (const view of [HOME_VIEW, agentView('ws-1'), agentView('ws-1', 'setup'), executionView('s-1')]) {
      const out = applyViewToSearchParams(params('session=old&agent=old&tab=files&task=t-1'), view);
      expect(viewFromSearchParams(out)).toEqual(view);
      expect(out.get('task')).toBe('t-1');
    }
  });

  it('clears the tab when the new view has none', () => {
    const out = applyViewToSearchParams(params('agent=ws-1&tab=files'), agentView('ws-2'));
    expect(out.toString()).toBe('agent=ws-2');
  });
});

describe('comparing views', () => {
  it('treats views as equal by content', () => {
    expect(sameView(agentView('ws-1', 'files'), { kind: 'agent', id: 'ws-1', tab: 'files' })).toBe(true);
    expect(sameView(agentView('ws-1'), agentView('ws-1', 'overview'))).toBe(false);
    expect(sameView(executionView('x'), agentView('x'))).toBe(false);
    expect(new Set([viewKey(HOME_VIEW), viewKey(executionView('x')), viewKey(agentView('x'))]).size).toBe(3);
  });

  it('names the session or agent on screen', () => {
    expect(activeSessionIdOf(executionView('s-1'))).toBe('s-1');
    expect(activeSessionIdOf(agentView('ws-1'))).toBeNull();
    expect(activeAgentIdOf(agentView('ws-1'))).toBe('ws-1');
    expect(activeAgentIdOf(HOME_VIEW)).toBeNull();
  });

  it('puts an execution or an agent under the phone’s Agents tab, however it was opened (P3.3)', () => {
    expect(mobileTabForView(executionView('s-1'))).toBe('agents');
    expect(mobileTabForView(agentView('ws-1', 'files'))).toBe('agents');
    expect(mobileTabForView(HOME_VIEW)).toBeNull();
  });

  it('knows the agent tabs', () => {
    expect(['overview', 'files', 'terminal', 'preview', 'setup'].every(isAgentTab)).toBe(true);
    expect(isAgentTab('chat')).toBe(false);
    expect(isAgentTab(null)).toBe(false);
  });
});
