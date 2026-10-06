/** PKCE (RFC 7636) — S256. The verifier is a proof-of-possession secret (§9). */
import { createHash } from 'node:crypto';
import { randomUrlToken } from '../core/ids';

export function generateCodeVerifier(): string {
  // 32 random bytes → 43-char base64url, within the RFC 7636 43–128 range.
  return randomUrlToken(32);
}

export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
