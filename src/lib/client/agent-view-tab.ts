import type { AgentTab } from '@/types/dashboard';
import { isAgentTab } from './active-view';

/**
 * The tools tab an agent's view last showed, per agent (docs/agents-view-spec.md
 * Phase 7). Opening an agent without a tab in the URL lands on it, so each
 * agent reopens where the user left it. Per-browser in localStorage.
 */

const KEY = (workspaceId: string) => `ri.agent.tab.${workspaceId}`;

export const DEFAULT_AGENT_TAB: AgentTab = 'overview';

export function readLastAgentTab(workspaceId: string): AgentTab {
  if (typeof window === 'undefined') return DEFAULT_AGENT_TAB;
  try {
    const raw = window.localStorage.getItem(KEY(workspaceId));
    return isAgentTab(raw) ? raw : DEFAULT_AGENT_TAB;
  } catch {
    return DEFAULT_AGENT_TAB;
  }
}

export function writeLastAgentTab(workspaceId: string, tab: AgentTab): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY(workspaceId), tab);
  } catch {
    /* localStorage can throw in private mode — non-fatal */
  }
}
