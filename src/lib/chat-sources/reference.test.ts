import { expect, it } from 'vitest';
import { accountSource, decodeSource, encodeSource, messageSources, parseSourceMarkers, sourceMarker, type SourceReference } from './reference';
const ref: SourceReference = { v: 1, kind: 'integration', toolkitId: 'gmail', account: { accountId: '日本語@example.test', authConfigId: null } };
it('round-trips Unicode, exact clients and only canonical identities', () => {
  const encoded = encodeSource(ref);
  expect(decodeSource(encoded)).toEqual(ref);
  expect(sourceMarker(encoded)).not.toContain('日本語');
  const nonCanonical = Buffer.from(JSON.stringify({ kind: ref.kind, v: ref.v, account: ref.account, toolkitId: ref.toolkitId, extra: 1 })).toString('base64url');
  expect(() => decodeSource(nonCanonical)).toThrow();
  expect(() => decodeSource(encoded + '=')).toThrow();
  expect(() => encodeSource({ ...ref, account: { ...ref.account, accountId: 'x'.repeat(3000) } })).toThrow();
  expect(encodeSource({ ...ref, account: { ...ref.account, authConfigId: 'work' } })).not.toBe(encoded);
});
it('rejects malformed and future references on send while keeping history readable', () => {
  for (const text of ['[[source:bad]]', '[[source:', '[[source:hello]partial', '[[source:x\ny]]', `[[source:${Buffer.from('{"v":2}').toString('base64url')}]]`]) {
    expect(parseSourceMarkers(text).some(s => s.type === 'source' && !s.valid)).toBe(true);
    expect(() => messageSources(text)).toThrow();
  }
});
it('deduplicates repeated sources but preserves every position and other markers', () => {
  const marker = sourceMarker(encodeSource(ref));
  expect(messageSources(`${marker} [[task:abc]] ${marker} [[file:x.txt]]`)).toEqual([encodeSource(ref)]);
  expect(parseSourceMarkers(`before ${marker} after ${marker}`).filter(s => s.type === 'source')).toHaveLength(2);
  expect(messageSources('@Gmail plain text')).toEqual([]);
  expect(() => messageSources(Array.from({ length: 17 }, (_, i) => sourceMarker(encodeSource({ ...ref, account: { accountId: String(i), authConfigId: null } }))).join(' '))).toThrow(/16/);
});
it('carries a mentioned resource canonically and keeps its account recoverable', () => {
  // An item Bits & Bolts' @ search returns: a resource link to one part in its library.
  const account = ref.kind === 'integration' ? ref.account : null!;
  const mention = { ...ref, resource: { name: 'hex-bolt.stl', uri: 'cad://parts/hex-bolt', title: 'M6 hex bolt' } } as SourceReference;
  const encoded = encodeSource(mention);
  expect(decodeSource(encoded)).toEqual({ ...ref, resource: { uri: 'cad://parts/hex-bolt', title: 'M6 hex bolt', name: 'hex-bolt.stl' } });
  // Key order never changes identity.
  expect(encodeSource({ v: 1, kind: 'integration', resource: { title: 'M6 hex bolt', uri: 'cad://parts/hex-bolt', name: 'hex-bolt.stl' }, account, toolkitId: 'gmail' })).toBe(encoded);
  expect(encoded).not.toBe(encodeSource(ref));
  expect(encodeSource(accountSource(decodeSource(encoded)))).toBe(encodeSource(ref));
  expect(decodeSource(encodeSource({ ...ref, resource: { uri: 'cad://parts/washer' } } as SourceReference))).toMatchObject({ resource: { uri: 'cad://parts/washer' } });
  expect(messageSources(`${sourceMarker(encoded)} and ${sourceMarker(encodeSource(ref))}`)).toHaveLength(2);
});
it('refuses a mentioned resource that is not a URI, carries control characters, or does not fit', () => {
  for (const resource of [{ uri: 'hex bolt' }, { uri: 'cad://parts/\u0000x' }, { uri: `cad://${'x'.repeat(1100)}` }, { uri: 'cad://a', title: 'x'.repeat(121) }, { uri: 'cad://a', extra: 1 }])
    expect(() => encodeSource({ ...ref, resource } as SourceReference)).toThrow();
});
