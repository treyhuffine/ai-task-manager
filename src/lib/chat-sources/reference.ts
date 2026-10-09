import { z } from 'zod';

export const MAX_SOURCE_BYTES = 2048;
export const MAX_MESSAGE_SOURCES = 16;
const identity = z.string().min(1).max(512).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
export const sourceReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ v: z.literal(1), kind: z.literal('app'), instanceId: z.string().uuid() }).strict(),
  z.object({ v: z.literal(1), kind: z.literal('integration'), toolkitId: identity,
    account: z.object({ accountId: identity, authConfigId: identity.nullable() }).strict() }).strict(),
]);
export type SourceReference = z.infer<typeof sourceReferenceSchema>;

/** Browser and server share exactly one canonical representation. Labels are never identity. */
export function encodeSource(value: SourceReference): string {
  const ref = sourceReferenceSchema.parse(value);
  const canonical = ref.kind === 'app' ? { v: ref.v, kind: ref.kind, instanceId: ref.instanceId }
    : { v: ref.v, kind: ref.kind, toolkitId: ref.toolkitId, account: { accountId: ref.account.accountId, authConfigId: ref.account.authConfigId } };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error('Source reference is too large');
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeSource(encoded: string): SourceReference {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > Math.ceil(MAX_SOURCE_BYTES * 4 / 3))
    throw new Error('Invalid source reference');
  const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error('Source reference is too large');
  const ref = sourceReferenceSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (encodeSource(ref) !== encoded) throw new Error('Source reference is not canonical');
  return ref;
}
export const sourceMarker = (encoded: string) => `[[source:${encoded}]]`;
export type SourceSegment = { type: 'text'; text: string } | { type: 'source'; encoded: string; valid: boolean };
/** History remains readable even for malformed, future or removed sources. */
export function parseSourceMarkers(text: string): SourceSegment[] {
  const out: SourceSegment[] = [];
  const pattern = /\[\[source:([\s\S]*?)(?:\]\]|$)/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > end) out.push({ type: 'text', text: text.slice(end, match.index) });
    let valid = match[0].endsWith(']]');
    try { decodeSource(match[1]); } catch { valid = false; }
    out.push({ type: 'source', encoded: match[1], valid });
    end = match.index! + match[0].length;
  }
  if (end < text.length) out.push({ type: 'text', text: text.slice(end) });
  return out;
}
export function messageSources(text: string): string[] {
  const found = new Set<string>();
  for (const part of parseSourceMarkers(text)) {
    if (part.type !== 'source') continue;
    if (!part.valid) throw new Error('This message has an invalid app reference. Remove it and select the app again.');
    found.add(part.encoded);
    if (found.size > MAX_MESSAGE_SOURCES) throw new Error('A message can mention up to 16 different apps or accounts.');
  }
  return [...found];
}
