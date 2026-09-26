/**
 * Session tokens: how a harness session on a connected computer reaches the
 * home's orchestrator, connectors and browser servers (docs/homes-build.md,
 * P2.7).
 *
 * A session at home uses the home's own key. A session elsewhere must not:
 * the key is the home's whole authority, and the worker's key would let the
 * session act as the worker. So the home mints a token for the session,
 * `<app>_session_<chat>.<computer>.<generation>.<signature>`, signed with its
 * key like the session credential. The signature also covers the worker
 * enrollment it was issued to, which the token doesn't carry. The token grants
 * nothing by itself. It's accepted only while its chat is active and placed on
 * that computer at that generation, and while the enrollment it was issued to
 * is that computer's current one. So archiving the chat, a move, a new
 * generation, or turning off the computer's local execution ends it, and
 * enrolling the computer again doesn't bring it back, with nothing stored to
 * revoke (P2.7 review fixes). It reaches only the servers the session was
 * given, each in the session's own scope (`sessionMayReach`).
 *
 * The token is a function of what it names, so a chat that is archived and
 * then restored at the same placement is issued the same token again. That is
 * the chat's own token, not a revival: only its session held it.
 */

import crypto from 'node:crypto';
import { APP_SHORT_ID } from '@/constants/app';
import type { ChatSessionRecord } from '@/db/types';
import { readAuthConfig } from '@/lib/auth/config-file';
import { chatPlacement, getChatSession, getWorkerEnrollmentForComputer } from '@/lib/db/queries';

export const SESSION_TOKEN_PREFIX = `${APP_SHORT_ID}_session_`;

function sign(chatSessionId: string, computerId: string, generation: string, workerApiKeyId: string, key: string): string {
  return crypto
    .createHmac('sha256', key)
    .update(`${APP_SHORT_ID}-session-token:${chatSessionId}:${computerId}:${generation}:${workerApiKeyId}`)
    .digest('base64url');
}

/**
 * The token for a session on a computer at a placement generation, issued to
 * that computer's current worker enrollment. Null before the home has a key,
 * or when the computer has no enrolled worker to run the session.
 */
export function mintSessionToken(
  session: { chatSessionId: string; computerId: string; generation: number | null },
  key: string | null | undefined = readAuthConfig()?.localToken,
): string | null {
  if (!key) return null;
  const worker = getWorkerEnrollmentForComputer(session.computerId);
  if (!worker) return null;
  const generation = session.generation === null ? 'n' : String(session.generation);
  const signature = sign(session.chatSessionId, session.computerId, generation, worker.apiKeyId, key);
  return `${SESSION_TOKEN_PREFIX}${session.chatSessionId}.${session.computerId}.${generation}.${signature}`;
}

export function isSessionToken(token: string): boolean {
  return token.startsWith(SESSION_TOKEN_PREFIX);
}

export interface VerifiedSession {
  chat: ChatSessionRecord;
  computerId: string;
  /** The key of that computer's worker, for attribution. */
  workerApiKeyId: string;
}

/**
 * The session a token names, when its signature is good for the computer's
 * current worker enrollment and it still holds: the chat is active and placed
 * on that computer at that generation. Null otherwise.
 */
export function verifySessionToken(
  token: string,
  key: string | null | undefined = readAuthConfig()?.localToken,
): VerifiedSession | null {
  if (!key || !isSessionToken(token)) return null;
  const parts = token.slice(SESSION_TOKEN_PREFIX.length).split('.');
  if (parts.length !== 4) return null;
  const [chatSessionId, computerId, generation, signature] = parts as [string, string, string, string];
  // Signed for the enrollment it was issued to: a token from a worker since
  // turned off fails here once the computer enrolls again.
  const worker = getWorkerEnrollmentForComputer(computerId);
  if (!worker) return null;
  const expected = Buffer.from(sign(chatSessionId, computerId, generation, worker.apiKeyId, key));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  const chat = getChatSession(chatSessionId);
  if (!chat || chat.status !== 'active') return null;
  const placement = chatPlacement(chatSessionId);
  if (!placement || placement.isHome || placement.computerId !== computerId) return null;
  if ((placement.generation === null ? 'n' : String(placement.generation)) !== generation) return null;
  return { chat, computerId, workerApiKeyId: worker.apiKeyId };
}

/** The servers a session is given, by path, and the scope each is locked to. */
const ORCHESTRATOR_MCP = '/api/orchestrator/mcp';
const CONNECTORS_MCP = '/api/connectors/mcp';
const BROWSER_MCP = '/api/orchestrator/browser/mcp';

/**
 * Whether a session may make this request: one of the servers it's given,
 * in its own scope, and nothing else. An execution gets its agent's
 * connectors and its agent's browser profile. An agent's main chat gets the
 * orchestrator too. Other chats never run elsewhere and get nothing.
 */
export function sessionMayReach(chat: ChatSessionRecord, pathname: string, params: URLSearchParams): boolean {
  const agent = chat.workspaceId ?? null;
  const isExecution = chat.type === 'execution';
  const isAgentMainChat = chat.type === 'orchestration' && agent !== null;
  if (!isExecution && !isAgentMainChat) return false;
  switch (pathname) {
    case ORCHESTRATOR_MCP:
      return isAgentMainChat;
    case CONNECTORS_MCP:
      return agent !== null && params.get('ws') === agent;
    case BROWSER_MCP:
      return params.get('profile') === (agent ? `ws-${agent}` : 'execution');
    default:
      return false;
  }
}
