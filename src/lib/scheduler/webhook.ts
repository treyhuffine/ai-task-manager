/**
 * Webhook intake helpers for schedules with `kind='webhook'`.
 *
 * Identity:  `webhookPublicId` — random 24-byte URL-safe slug; the
 *            path segment of `/api/triggers/<publicId>`.
 * Auth:      `webhookSecretHash` — sha256 hex of a separate 32-byte
 *            secret shown only at create time. The caller sends
 *            `X-Signature: sha256=<hex>` where `<hex>` is the HMAC
 *            of the raw request body using the *plain-text secret*.
 *            We re-hash the secret with sha256 and compare against
 *            `webhookSecretHash`, then recompute HMAC ourselves to
 *            verify the body.
 *
 * The "plaintext secret" never lives in the DB. After it's shown to
 * the user once at create-time they're responsible for storing it on
 * their side. Re-rolling generates a new one.
 */

import crypto from 'node:crypto';

const PUBLIC_ID_BYTES = 24;
const SECRET_BYTES = 32;
/** Body cap (256 KiB) per docs/async-agents-v1.md open question #6. */
export const WEBHOOK_BODY_MAX_BYTES = 256 * 1024;

export interface NewWebhookCredentials {
  /** Path segment, e.g. `Lf3PqW…`. URL-safe base64, no padding. */
  publicId: string;
  /** Plain-text secret shown to the user once. The caller signs with this. */
  secret: string;
  /** Stored on the schedule row. sha256(secret) hex. */
  secretHash: string;
}

/** Generate a fresh credential pair for a new webhook schedule. */
export function generateWebhookCredentials(): NewWebhookCredentials {
  const publicId = randomBase64Url(PUBLIC_ID_BYTES);
  const secret = randomBase64Url(SECRET_BYTES);
  const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
  return { publicId, secret, secretHash };
}

/**
 * Verify a webhook request. Returns true when the signature is valid
 * AND the secret it was signed with hashes to the stored hash.
 *
 * The signature header is `sha256=<hex>` (GitHub convention). We
 * tolerate plain `<hex>` too since hand-rolled scripts often skip the
 * prefix.
 *
 * Timing: uses `timingSafeEqual` on equal-length buffers to avoid
 * leaking byte-by-byte comparison time.
 *
 * Caveat: V1 doesn't store the plain-text secret; if the caller signs
 * with the wrong secret we can't tell *which* secret they used, only
 * that the resulting HMAC doesn't match a valid one. That's the right
 * trade for V1 — store-the-hash means a DB compromise doesn't leak
 * the live signing key.
 *
 * Because we don't have the secret in hand, we use the body+signature
 * to *infer* it differently: the caller already had the secret to
 * compute their HMAC. We can't infer back, so the protocol degrades
 * to: caller sends `X-Webhook-Secret: <plaintext>` alongside
 * `X-Signature`. We hash + compare for identity, then HMAC + compare
 * for integrity. This is materially weaker than a stored-key HMAC
 * verify but compatible with not storing the secret at rest.
 *
 * For V1 we accept that trade — single-user, single-machine, the
 * threat model is "someone scrapes my .env" not "someone reads my
 * DB". V2 can shift to a stored-encrypted-secret pattern.
 */
export function verifyWebhookRequest(args: {
  rawBody: Buffer;
  signatureHeader: string | null;
  secretHeader: string | null;
  storedSecretHash: string;
}): { ok: boolean; reason?: string } {
  if (!args.secretHeader) {
    return { ok: false, reason: 'missing X-Webhook-Secret' };
  }
  if (!args.signatureHeader) {
    return { ok: false, reason: 'missing X-Signature' };
  }
  const candidateHash = crypto
    .createHash('sha256')
    .update(args.secretHeader)
    .digest('hex');
  if (!timingSafeEqHex(candidateHash, args.storedSecretHash)) {
    return { ok: false, reason: 'bad secret' };
  }
  const computed = crypto
    .createHmac('sha256', args.secretHeader)
    .update(args.rawBody)
    .digest('hex');
  const provided = args.signatureHeader.replace(/^sha256=/, '').trim();
  if (!timingSafeEqHex(computed, provided)) {
    return { ok: false, reason: 'bad signature' };
  }
  return { ok: true };
}

function randomBase64Url(bytes: number): string {
  return crypto
    .randomBytes(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function timingSafeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
