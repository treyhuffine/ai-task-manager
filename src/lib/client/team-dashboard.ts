import { HOME_VIEW, agentView, executionView, isAgentTab, viewFromSearchParams } from './active-view';
import type { ActiveView, AnyPanelTab, PanelId } from '@/types/dashboard';

/** Old Team links remain valid while new navigation uses the ordinary app URLs. */
export function teamDashboardView(params: Pick<URLSearchParams, 'get' | 'toString'>): ActiveView {
  if (params.get('session')) return viewFromSearchParams(params);
  const chat = params.get('chat');
  const agent = params.get('agent');
  if (chat && (params.get('view') === 'chat' || !agent)) return executionView(chat);
  if (agent) {
    const tab = params.get('tab') ?? params.get('agentTab');
    return agentView(agent, isAgentTab(tab) ? tab : undefined, chat ?? undefined, params.get('message') ?? undefined);
  }
  return HOME_VIEW;
}
export function teamHomePanels(params: Pick<URLSearchParams, 'get'>): Record<PanelId, AnyPanelTab> {
  return params.get('view') === 'notes' ? { a: 'chat', b: 'notes' } : { a: 'chat', b: 'tasks' };
}
