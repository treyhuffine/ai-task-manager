/** Id + random-token generation. */
import { randomBytes } from 'node:crypto';
import { uuidv7 } from 'uuidv7';

/** Stable, time-sortable id for a connection. */
export function newId(): string {
  return uuidv7();
}

/** Correlation id joining an audit `start`/`finish` pair (§8); time-sortable. */
export function newAttemptId(): string {
  return uuidv7();
}

/** URL-safe high-entropy token for OAuth `state` and PKCE `code_verifier`. */
export function randomUrlToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
