/**
 * Who is calling an MCP route, from the headers the proxy validated. Shared by
 * the orchestrator MCP and the browser MCP so both attribute calls the same way.
 *
 * Which chat is calling: a session elsewhere is the chat its token names, as the
 * proxy verified it (P2.7). A session at home is the chat its signed credential
 * names (session-credential.ts). Unsigned or unknown: no actor.
 */

import { API_KEY_ID_HEADER, API_KEY_SCOPE_HEADER, CALLER_LOCATION_HEADER, SESSION_CHAT_HEADER } from '@/lib/auth/request-key';
import type { ActionContext } from './types';
import { actorFromSessionCredential, actorOfChat, sessionCredentialFromHeaders } from './session-credential';

export type McpHeaders = Headers | Record<string, string | string[] | undefined> | null | undefined;

function headerOf(headers: McpHeaders, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  const v = (headers as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? v[0] : v;
}

/** The remote-call context for an MCP request: the acting chat and where the key lives. */
export function mcpCallContext(headers: McpHeaders): ActionContext {
  const sessionChat =
    headerOf(headers, API_KEY_SCOPE_HEADER) === 'session' ? headerOf(headers, SESSION_CHAT_HEADER) : undefined;
  const actor = sessionChat ? actorOfChat(sessionChat) : actorFromSessionCredential(sessionCredentialFromHeaders(headers));
  return {
    remote: true,
    actor,
    caller: {
      location: headerOf(headers, CALLER_LOCATION_HEADER) === 'home' ? 'home' : 'elsewhere',
      apiKeyId: headerOf(headers, API_KEY_ID_HEADER) ?? null,
    },
  };
}
