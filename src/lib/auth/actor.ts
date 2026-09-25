/**
 * Who is acting, from the credentials a request or action carries
 * (docs/homes-spec.md §6, P2.6), never from anything the caller says about
 * itself. It goes on every command to a connected computer and decides what
 * the actor may answer.
 *
 * - A chat's signed session credential makes the actor that agent.
 * - Otherwise a request the proxy let through is a person, on the key it
 *   accepted: the app, or the home's own CLI run by hand.
 * - An orchestrator action without a session credential is a person only
 *   from the home's own CLI (run here, or passed to the server with the
 *   home's key). Over HTTP with any other key it's an agent, as its
 *   transport says: treating an unknown remote caller as a person would let
 *   an agent on another computer approve for the user with a key it found
 *   on disk. A person there answers in the app.
 *
 * An agent holding the home's own key file can still pass for a person on
 * the home. That's the limit of credentials on one machine (the isolation is
 * paths, not keys), and why sessions on connected computers get tokens of
 * their own (P2.7).
 */

import type { WorkerCommandActor } from '@/db/types';
import { SESSION_CREDENTIAL_HEADER, verifySessionCredential } from '@/lib/orchestrator/session-credential';
import type { ActionContext } from '@/lib/orchestrator/types';
import { getRequestKey } from './request-key';

export function actorFromRequest(headers: Headers): WorkerCommandActor {
  const apiKeyId = getRequestKey(headers)?.apiKeyId ?? null;
  const sessionId = verifySessionCredential(headers.get(SESSION_CREDENTIAL_HEADER));
  return sessionId ? { source: 'ai', sessionId, apiKeyId } : { source: 'human', sessionId: null, apiKeyId };
}

export function actorFromAction(ctx: ActionContext): WorkerCommandActor {
  const apiKeyId = ctx.caller?.apiKeyId ?? null;
  if (ctx.actor?.sessionId) return { source: 'ai', sessionId: ctx.actor.sessionId, apiKeyId };
  const homeCli = ctx.remote === false || ctx.caller?.location === 'home';
  return { source: homeCli ? 'human' : 'ai', sessionId: null, apiKeyId };
}

/** Who sent a stored message: the chat that sent it, or else the person. */
export function actorOfMessage(senderSessionId: string | null | undefined): WorkerCommandActor {
  return senderSessionId ? { source: 'ai', sessionId: senderSessionId, apiKeyId: null } : { source: 'human', sessionId: null, apiKeyId: null };
}
