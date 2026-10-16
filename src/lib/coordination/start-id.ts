import { createHash } from 'node:crypto';
import { APP_SHORT_ID } from '@/constants/app';

/** Preserve the public start_execution idempotency namespace. */
export function requestScopedId(kind: 'session' | 'prompt', workspaceId: string, requestId: string): string {
  const hash = createHash('sha256').update(`${APP_SHORT_ID}:start_execution:${kind}:${workspaceId}:${requestId}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x80;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
