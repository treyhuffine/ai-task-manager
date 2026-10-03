/**
 * Guard for the agent main chat routes (docs/agents-view-spec.md Phase 5).
 * Lives outside the `route.ts` files because Next.js's app router rejects
 * exports that aren't HTTP method handlers or segment configs.
 */

import type { WorkspaceRecord } from '@/db/types';
import { getWorkspace } from '@/lib/db/queries';

export type AgentResolution =
  | { ok: true; ws: WorkspaceRecord }
  | { ok: false; response: Response };

/** The workspace behind an agent's main chat, or a 404. */
export function resolveAgent(id: string): AgentResolution {
  const ws = getWorkspace(id);
  if (!ws) return { ok: false, response: Response.json({ error: 'Workspace not found' }, { status: 404 }) };
  return { ok: true, ws };
}

/**
 * Reading an archived agent's chats is fine. Starting or resuming a
 * conversation with it is not.
 */
export function archivedAgentResponse(): Response {
  return Response.json({ error: 'This agent is archived' }, { status: 409 });
}
