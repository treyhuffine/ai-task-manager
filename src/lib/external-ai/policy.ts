import type { ApiKeyRecord } from '@/db/types';

export const HOME_MCP_PATH = '/api/orchestrator/mcp';

/** Explicit scope: adding a registry action never silently grants it to outside clients. */
export const HOME_CONTENT_ACTIONS = [
  'list_tasks', 'list_deadlines', 'get_task', 'create_task', 'update_task', 'complete_task', 'transition_task',
  'list_notes', 'get_note', 'create_note', 'update_note', 'list_backlinks', 'list_outgoing_links',
  'list_areas', 'get_area', 'create_area', 'update_area', 'get_deck', 'update_deck', 'search',
] as const;

export function permitsHomeContentAction(name: string): boolean {
  return (HOME_CONTENT_ACTIONS as readonly string[]).includes(name);
}

/** Member-bound keys belong to teams. Device-bound keys are never personal MCP credentials. */
export function isPersonalAiClientKey(key: Pick<ApiKeyRecord, 'role' | 'memberId' | 'deviceId'>): boolean {
  return key.role === 'ai_client' && key.memberId === null && key.deviceId === null;
}
