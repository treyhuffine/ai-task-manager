import { createHash } from 'node:crypto';

/** UUIDv8: stable per source and intent, without exposing message contents. */
export function stableCoordinationId(...parts: string[]): string {
  const bytes = createHash('sha256').update(JSON.stringify(['ri:coordination:v1', ...parts])).digest();
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
