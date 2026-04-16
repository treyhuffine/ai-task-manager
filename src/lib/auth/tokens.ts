/**
 * Token generation and hashing for Bearer auth.
 *
 * Format: <APP_SHORT_ID>_<env>_<random 40-char alphanumeric>
 *   e.g. <prefix>_live_V1StGXR8Z5jdHi6BmyT1abc0Vy4mX3wQrS7Nop9Lu
 *
 * Alphanumeric-only (A-Za-z0-9, 62 chars) at length 40 → ~238 bits of entropy.
 * Dropped `_` and `-` so (a) double-click selection grabs the whole token and
 * (b) the `_` separator between prefix and payload stays visually unambiguous.
 * The plaintext token is returned exactly once; only its SHA-256 hash is stored in the DB.
 */

import { createHash } from 'node:crypto';
import { customAlphabet } from 'nanoid';
import { APP_SHORT_ID } from '@/constants/app';

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_LENGTH = 40;
const randomToken = customAlphabet(TOKEN_ALPHABET, TOKEN_LENGTH);

export type TokenEnv = 'live' | 'test';

export function getTokenEnv(): TokenEnv {
  return process.env.AUTH_TOKEN_ENV === 'test' ? 'test' : 'live';
}

export interface GeneratedToken {
  plaintext: string;
  prefix: string;
  suffix: string;
  hash: string;
  env: TokenEnv;
}

export function generateToken(env: TokenEnv = getTokenEnv()): GeneratedToken {
  const random = randomToken();
  const plaintext = `${APP_SHORT_ID}_${env}_${random}`;
  return {
    plaintext,
    prefix: random.slice(0, 6),
    suffix: random.slice(-4),
    hash: hashToken(plaintext),
    env,
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenDisplay(prefix: string, suffix: string, env: TokenEnv = 'live'): string {
  return `${APP_SHORT_ID}_${env}_${prefix}…${suffix}`;
}
