/**
 * A small deterministic hash for stable item IDs inside records (requirements,
 * compensation lines). It runs in the backend and the sandboxed view alike.
 * Content digests that protect immutable records use SHA-256 in the backend.
 */
export function stableHash(value: string): string {
  // Two independent FNV-1a lanes give 64 bits, repeated to a fixed width.
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ ((code * 31) & 0xffff), 0x01000193) >>> 0;
  }
  const part = (n: number) => n.toString(16).padStart(8, '0');
  const first = part(a) + part(b);
  return (first + part(Math.imul(a ^ b, 0x27d4eb2d) >>> 0) + part((a + b) >>> 0)).repeat(2);
}
