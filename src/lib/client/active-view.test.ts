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
  viewHref,
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

  it('reads a chat open beside the agent’s main chat, and one message in it', () => {
    expect(viewFromSearchParams(params('agent=ws-1&chat=c-1'))).toEqual({ kind: 'agent', id: 'ws-1', chat: 'c-1' });
    expect(viewFromSearchParams(params('agent=ws-1&tab=files&chat=c-1&message=e-1'))).toEqual({
      kind: 'agent', id: 'ws-1', tab: 'files', chat: 'c-1', message: 'e-1',
    });
    // A message means one in the chat beside, so without a chat it means nothing.
    expect(viewFromSearchParams(params('agent=ws-1&message=e-1'))).toEqual({ kind: 'agent', id: 'ws-1' });
  });

  it('lets session win when a URL carries both', () => {
    expect(viewFromSearchParams(params('agent=ws-1&session=s-1'))).toEqual({ kind: 'execution', id: 's-1' });
  });
});

describe('applyViewToSearchParams', () => {
  it('round-trips every view and keeps unrelated params', () => {
    for (const view of [HOME_VIEW, agentView('ws-1'), agentView('ws-1', 'setup'), agentView('ws-1', undefined, 'c-1'), agentView('ws-1', 'files', 'c-1', 'e-1'), executionView('s-1')]) {
      const out = applyViewToSearchParams(params('session=old&agent=old&tab=files&task=t-1'), view);
      expect(viewFromSearchParams(out)).toEqual(view);
      expect(out.get('task')).toBe('t-1');
    }
  });

  it('clears the tab when the new view has none', () => {
    const out = applyViewToSearchParams(params('agent=ws-1&tab=files'), agentView('ws-2'));
    expect(out.toString()).toBe('agent=ws-2');
  });

  it('puts the chat beside away, with its message, and drops both when leaving the agent', () => {
    const beside = applyViewToSearchParams(params('agent=ws-1&tab=files'), agentView('ws-1', 'files', 'c-1', 'e-1'));
    expect(beside.toString()).toBe('agent=ws-1&tab=files&chat=c-1&message=e-1');
    expect(applyViewToSearchParams(new URLSearchParams(beside), agentView('ws-1', 'files')).toString()).toBe('agent=ws-1&tab=files');
    expect(applyViewToSearchParams(new URLSearchParams(beside), executionView('c-1')).toString()).toBe('session=c-1');
    expect(viewHref(agentView('ws-1', undefined, 'c-1'))).toBe('/?agent=ws-1&chat=c-1');
  });
  it('preserves native entity links while replacing and then clearing app query state',()=>{
    const app={kind:'apps' as const,route:'finance',query:{filter:'dining'}};
    const first=applyViewToSearchParams(params('task=t-1&session=old'),app);
    expect(first.toString()).toBe('task=t-1&filter=dining');
    expect(viewFromSearchParams(first,'/apps/finance')).toEqual(app);
    const next={kind:'apps' as const,route:'finance/views/view-1',query:{period:'October'}};
    const second=applyViewToSearchParams(first,next,app);
    expect(second.toString()).toBe('task=t-1&period=October');
    const home=applyViewToSearchParams(second,HOME_VIEW,next);
    expect(home.toString()).toBe('task=t-1');
  });
});

describe('overlays over an app', () => {
  const overlays = ['board=activity', 'board=tasks&boardFocus=unread', 'calendar=1', 'settings=plugins&plugin=mcp%3As-1'];

  it('leaves the app where it was when the Board, the Calendar or Settings opens over it', () => {
    for (const path of ['/apps', '/apps/finance/views/view-1']) {
      const before = viewFromSearchParams(params('layout=discover'), path);
      for (const overlay of overlays) {
        expect(viewKey(viewFromSearchParams(params(`layout=discover&${overlay}`), path))).toBe(viewKey(before));
      }
    }
  });

  it('keeps an open overlay in the URL while the app moves, and never lets an app write one', () => {
    const app = { kind: 'apps' as const, route: 'finance', query: { filter: 'dining' } };
    for (const overlay of overlays) {
      const next = applyViewToSearchParams(params(`filter=dining&${overlay}`), { kind: 'apps', route: 'finance', query: { period: 'October' } }, app);
      expect(next.toString()).toBe(`${overlay}&period=October`);
    }
    const written = applyViewToSearchParams(params(''), { kind: 'apps', route: 'finance', query: { board: 'tasks', calendar: '1', settings: 'general', period: 'October' } });
    expect(written.toString()).toBe('period=October');
  });
});

describe('comparing views', () => {
  it('treats views as equal by content', () => {
    expect(sameView(agentView('ws-1', 'files'), { kind: 'agent', id: 'ws-1', tab: 'files' })).toBe(true);
    expect(sameView(agentView('ws-1'), agentView('ws-1', 'overview'))).toBe(false);
    expect(sameView(executionView('x'), agentView('x'))).toBe(false);
    expect(new Set([viewKey(HOME_VIEW), viewKey(executionView('x')), viewKey(agentView('x'))]).size).toBe(3);
    expect(sameView(agentView('ws-1', undefined, 'c-1'), agentView('ws-1'))).toBe(false);
    expect(sameView(agentView('ws-1', undefined, 'c-1'), agentView('ws-1', undefined, 'c-2'))).toBe(false);
    expect(sameView(agentView('ws-1', 'files', 'c-1'), { kind: 'agent', id: 'ws-1', tab: 'files', chat: 'c-1' })).toBe(true);
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

describe('viewHref', () => {
  it('gives a view its own address, for pages outside the dashboard', () => {
    expect(viewHref({ kind: 'apps', route: 'finances/accounts', query: { month: '2026-10' } })).toBe('/apps/finances/accounts?month=2026-10');
    expect(viewHref({ kind: 'apps', route: '' })).toBe('/apps');
    expect(viewHref(executionView('chat-1'))).toBe('/?session=chat-1');
    expect(viewHref(agentView('ws', 'files'))).toBe('/?agent=ws&tab=files');
    expect(viewHref(HOME_VIEW)).toBe('/');
  });

  it('round-trips through the parser', () => {
    const view = { kind: 'apps' as const, route: 'finances', query: { tab: 'x' } };
    const href = new URL(viewHref(view), 'http://ri.test');
    // `tab` is the agent view's own key, so an app never carries it.
    expect(viewFromSearchParams(href.searchParams, href.pathname)).toEqual({ kind: 'apps', route: 'finances' });
  });
});
