import type { McpServerConfig } from '@agentex/agent';
import { readAuthConfig } from '@/lib/auth/config-file';
import { sessionCredential, SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import { resolveServerPort } from '@/lib/orchestrator/harness-surface';

export const COORDINATION_TOOLS = [
  'get_session_context', 'message_agent', 'delegate_work', 'get_agent_request', 'get_agent_delivery', 'list_agent_requests', 'reply_agent_request', 'cancel_agent_request',
  'list_workspaces', 'get_workspace', 'get_session_messages', 'get_session_events', 'get_chat_event', 'search_sessions',
  'get_pending_input', 'answer_pending_input', 'read_memory',
  // Schedules, so a chat can book its own check-ins (target_kind=session)
  // with typed tools instead of shelling out to the signed CLI, which
  // reaches the same actions.
  'create_trigger', 'list_triggers', 'get_trigger', 'update_trigger', 'delete_trigger',
] as const;

export function coordinationMcpServer(sessionId: string): McpServerConfig | null {
  const token = readAuthConfig()?.localToken;
  if (!token) return null;
  const credential = sessionCredential(sessionId, token);
  return { name: 'coordination', type: 'http', url: `http://localhost:${resolveServerPort()}/api/orchestrator/coordination/mcp`,
    headers: { Authorization: `Bearer ${token}`, ...(credential ? { [SESSION_CREDENTIAL_HEADER]: credential } : {}) } };
}

export { COORDINATION_INSTRUCTIONS } from './instructions';
