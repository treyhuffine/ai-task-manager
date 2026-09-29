/**
 * Which chat is calling an orchestrator action (docs/agents-view-spec.md
 * Phase 4, "Caller identity").
 *
 * Every harness session is handed a credential when it spawns:
 * `<chatSessionId>.<HMAC-SHA256(localToken, "<app>-session:<chatSessionId>")>`.
 * Only a process holding the local token can mint one, so a credential that
 * verifies names a session the app itself started. It reaches the action
 * layer two ways:
 *
 *   - MCP mode: as the `x-<app>-session` header on the orchestrator MCP
 *     config attached to the session. The MCP route resolves it per call.
 *   - Skills mode: as the `<APP>_SESSION_CREDENTIAL` env var on the harness
 *     process. The `<cli> agent` command, run from the harness's shell,
 *     inherits it and resolves it the same way.
 *
 * A bare session id, a forged signature, or a credential for a chat that no
 * longer exists resolves to nothing, and the action runs with no actor
 * (today's behavior for a human at the CLI). This is identity, not
 * authorization: `ctx.remote` still decides what an untrusted transport may
 * do.
 */

import crypto from 'node:crypto';
import { APP_SHORT_ID } from '@/constants/app';
import { readAuthConfig } from '@/lib/auth/config-file';
import { getChatSession } from '@/lib/db/queries';
import type { ActionContext } from './types';

export const SESSION_CREDENTIAL_HEADER = `x-${APP_SHORT_ID}-session`;
export const SESSION_CREDENTIAL_ENV = `${APP_SHORT_ID.toUpperCase()}_SESSION_CREDENTIAL`;

function sign(sessionId: string, token: string): string {
  return crypto.createHmac('sha256', token).update(`${APP_SHORT_ID}-session:${sessionId}`).digest('base64url');
}

/** Mint the credential for a chat session, or null before the app has a local token. */
export function sessionCredential(
  sessionId: string,
  token: string | null | undefined = readAuthConfig()?.localToken,
): string | null {
  if (!token || !sessionId) return null;
  return `${sessionId}.${sign(sessionId, token)}`;
}

/** The session id a credential names, or null unless its signature verifies. */
export function verifySessionCredential(
  credential: unknown,
  token: string | null | undefined = readAuthConfig()?.localToken,
): string | null {
  if (typeof credential !== 'string' || !token) return null;
  const dot = credential.lastIndexOf('.');
  if (dot <= 0 || dot === credential.length - 1) return null;
  const sessionId = credential.slice(0, dot);
  const given = Buffer.from(credential.slice(dot + 1));
  const expected = Buffer.from(sign(sessionId, token));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  return sessionId;
}

/** Resolve a credential to the acting chat, if it verifies and the chat still exists. */
export function actorFromSessionCredential(credential: unknown): ActionContext['actor'] | undefined {
  const sessionId = verifySessionCredential(credential);
  return sessionId ? actorOfChat(sessionId) : undefined;
}

/** A chat, already verified as the caller, as the acting agent. Undefined when the chat is gone. */
export function actorOfChat(sessionId: string): ActionContext['actor'] | undefined {
  const session = getChatSession(sessionId);
  if (!session) return undefined;
  return { source: 'ai', sessionId, executionId: session.executionId ?? null };
}

/** Pick the credential out of request headers, whatever their casing or shape. */
export function sessionCredentialFromHeaders(
  headers: Headers | Record<string, string | string[] | undefined> | null | undefined,
): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(SESSION_CREDENTIAL_HEADER);
  for (const [name, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (name.toLowerCase() !== SESSION_CREDENTIAL_HEADER) continue;
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }
  return null;
}
