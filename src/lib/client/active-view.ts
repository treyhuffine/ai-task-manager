import { AGENT_TABS, type ActiveView, type AgentTab } from '@/types/dashboard';

/**
 * Building, comparing and URL-encoding the dashboard's active view
 * (`ActiveView` in `src/types/dashboard.ts`). The URL is the canonical
 * owner: `?session=` for an execution, `?agent=` (plus `&tab=`) for an
 * agent's view, `?skill=` for a skill's builder, none of them for Home.
 * `session` wins if a URL somehow carries more than one, then `agent`.
 */

export const HOME_VIEW: ActiveView = { kind: 'home' };
const NATIVE_QUERY_KEYS = new Set(['session','agent','tab','skill','task','note','area']);

export const executionView = (id: string): ActiveView => ({ kind: 'execution', id });

export const agentView = (id: string, tab?: AgentTab): ActiveView =>
  tab ? { kind: 'agent', id, tab } : { kind: 'agent', id };

export const skillView = (ref: string): ActiveView => ({ kind: 'skill', ref });

export function isAgentTab(value: unknown): value is AgentTab {
  return typeof value === 'string' && (AGENT_TABS as readonly string[]).includes(value);
}

/** The view a URL's search params describe. */
export function viewFromSearchParams(params: Pick<URLSearchParams, 'get' | 'toString'>, pathname = '/'): ActiveView {
  if (pathname === '/apps' || pathname.startsWith('/apps/')) {
    const query = new URLSearchParams(params.toString());
    for (const key of NATIVE_QUERY_KEYS) query.delete(key);
    return { kind: 'apps', route: pathname.slice(6), ...(query.size ? {query:Object.fromEntries(query)} : {}) };
  }
  const session = params.get('session');
  if (session) return executionView(session);
  const agent = params.get('agent');
  if (agent) {
    const tab = params.get('tab');
    return agentView(agent, isAgentTab(tab) ? tab : undefined);
  }
  const skill = params.get('skill');
  if (skill) return skillView(skill);
  return HOME_VIEW;
}

/** Write the view into search params, leaving unrelated params alone. */
export function applyViewToSearchParams(params: URLSearchParams, view: ActiveView, previous?:ActiveView): URLSearchParams {
  if(previous?.kind==='apps')for(const key of Object.keys(previous.query??{}))params.delete(key);
  params.delete('session');
  params.delete('agent');
  params.delete('tab');
  params.delete('skill');
  if (view.kind === 'apps') {
    for(const [key,value] of Object.entries(view.query??{}))if(!NATIVE_QUERY_KEYS.has(key))params.set(key,value);
    return params;
  }
  if (view.kind === 'execution') params.set('session', view.id);
  if (view.kind === 'skill') params.set('skill', view.ref);
  if (view.kind === 'agent') {
    params.set('agent', view.id);
    if (view.tab) params.set('tab', view.tab);
  }
  return params;
}

/** A stable string for a view, for effect deps and equality. */
export function viewKey(view: ActiveView): string {
  switch (view.kind) {
    case 'apps':
      return `apps:${view.route}:${JSON.stringify(view.query ?? {})}`;
    case 'home':
      return 'home';
    case 'execution':
      return `execution:${view.id}`;
    case 'agent':
      return `agent:${view.id}:${view.tab ?? ''}`;
    case 'skill':
      return `skill:${view.ref}`;
  }
}

export function sameView(a: ActiveView, b: ActiveView): boolean {
  return viewKey(a) === viewKey(b);
}

/** The execution chat on screen, or null outside the execution view. */
export function activeSessionIdOf(view: ActiveView): string | null {
  return view.kind === 'execution' ? view.id : null;
}

/** The agent whose view is on screen, or null. */
export function activeAgentIdOf(view: ActiveView): string | null {
  return view.kind === 'agent' ? view.id : null;
}

/**
 * The phone tab a view lives under, or null to leave the tab alone: an
 * execution, an agent or a skill's builder is shown full screen under
 * Agents, so opening one from anywhere (a link, Back/Forward, a chip in the
 * main chat) moves the tab there. Home belongs to no tab in particular.
 */
export function mobileTabForView(view: ActiveView): 'agents' | null {
  return view.kind === 'home' ? null : 'agents';
}
