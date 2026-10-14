/**
 * The credential one turn of the team's AI uses for the team's tools
 * (docs/homes-spec.md §9.9, P8.4). It names the turn, its chat and the member
 * whose message started it, is signed with the team AI's own secret, and
 * lasts only while that turn runs: the team's MCP checks the turn is still
 * running, the member still in the team and Team AI still on, on every call.
 *
 * It is not the host's key, not anyone's sign-in and not an AI client's key,
 * and it reaches nothing but the team's MCP.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { turnSigningSecret } from './secrets';

export const TURN_TOKEN_PREFIX = 'rtt_';

/** Longer than any turn should take. A turn that ends sooner ends its credential with it. */
export const TURN_TOKEN_TTL_MS = 30 * 60 * 1000;

export interface TurnClaims {
  turnId: string;
  chatId: string;
  memberId: string;
  expiresAt: number;
}

function sign(payload: string): string {
  return createHmac('sha256', turnSigningSecret()).update(`team-ai-turn-v1.${payload}`).digest('base64url');
}

export function mintTurnToken(claims: Omit<TurnClaims, 'expiresAt'>, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ t: claims.turnId, c: claims.chatId, m: claims.memberId, e: now + TURN_TOKEN_TTL_MS })).toString('base64url');
  return `${TURN_TOKEN_PREFIX}${payload}.${sign(payload)}`;
}

export function isTurnToken(token: string): boolean {
  return token.startsWith(TURN_TOKEN_PREFIX);
}

/** The claims of a token this team signed that hasn't expired, or null. Says nothing about the turn's state. */
export function readTurnToken(token: string, now = Date.now()): TurnClaims | null {
  if (!isTurnToken(token)) return null;
  const [payload, signature, ...rest] = token.slice(TURN_TOKEN_PREFIX.length).split('.');
  if (!payload || !signature || rest.length) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { t?: unknown; c?: unknown; m?: unknown; e?: unknown };
    if (typeof raw.t !== 'string' || typeof raw.c !== 'string' || typeof raw.m !== 'string' || typeof raw.e !== 'number') return null;
    if (raw.e <= now) return null;
    return { turnId: raw.t, chatId: raw.c, memberId: raw.m, expiresAt: raw.e };
  } catch {
    return null;
  }
}
