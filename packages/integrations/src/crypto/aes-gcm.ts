/**
 * The default `SecretBox` (§9/§10): AES-256-GCM authenticated encryption, so
 * hosts never roll their own crypto. The store only ever sees the opaque sealed
 * envelope; the runtime seals before `save` and opens after `get`.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import type { SecretBox, SealedSecret } from '../core/types';

export interface AesGcmOptions {
  /** 32-byte key (Buffer/Uint8Array) used directly, or any string/bytes hashed to 32 bytes. */
  key: Buffer | Uint8Array | string;
}

interface Envelope {
  v: 1;
  iv: string;
  ct: string;
  tag: string;
}

function normalizeKey(key: Buffer | Uint8Array | string): Buffer {
  if (typeof key === 'string') return createHash('sha256').update(key).digest();
  const buf = Buffer.from(key);
  return buf.length === 32 ? buf : createHash('sha256').update(buf).digest();
}

export function aesGcmSecretBox(opts: AesGcmOptions): SecretBox {
  const key = normalizeKey(opts.key);
  return {
    async seal(value): Promise<SealedSecret> {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const pt = Buffer.from(JSON.stringify(value ?? null), 'utf8');
      const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
      const env: Envelope = {
        v: 1,
        iv: iv.toString('base64'),
        ct: ct.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
      };
      return JSON.stringify(env);
    },
    async open<T = unknown>(sealed: SealedSecret): Promise<T> {
      const env = JSON.parse(sealed) as Envelope;
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
      const pt = Buffer.concat([decipher.update(Buffer.from(env.ct, 'base64')), decipher.final()]);
      return JSON.parse(pt.toString('utf8')) as T;
    },
  };
}

/** Generate a fresh base64 32-byte key for `aesGcmSecretBox`. */
export function generateSecretKey(): string {
  return randomBytes(32).toString('base64');
}

/**
 * Plaintext box — TESTS ONLY. Encrypts nothing; lets confinement tests assert the
 * runtime never leaks even when the "sealed" value is readable. Never use in a
 * non-test adapter (§10: secrets are encrypted from day one).
 */
export function plaintextSecretBox(): SecretBox {
  return {
    async seal(value): Promise<SealedSecret> {
      return JSON.stringify({ plaintext: value ?? null });
    },
    async open<T = unknown>(sealed: SealedSecret): Promise<T> {
      return (JSON.parse(sealed) as { plaintext: T }).plaintext;
    },
  };
}
