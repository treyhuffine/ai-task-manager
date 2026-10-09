import { expect, it } from 'vitest';
import { decodeSource, encodeSource, messageSources, parseSourceMarkers, sourceMarker, type SourceReference } from './reference';
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
