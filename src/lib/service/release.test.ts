import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, it } from 'vitest';
import { verifyRelease } from './release';
const pair = generateKeyPairSync('ed25519');
const publicKey = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const now = Date.now();
const release = { format: 1, sequence: 2, version: '0.2.0', channel: 'stable', publishedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), platform: process.platform, arch: process.arch, minimumUpdater: 1, apiProtocol: 1, configFormat: 1, withdrawn: false, notes: 'Test release', migrationHistory: 'a'.repeat(64), runtime: { id: 'b'.repeat(64), url: 'https://releases.example/runtime.tar.gz', sha256: 'c'.repeat(64), size: 10, unpackedSize: 100 } };
function envelope(change = {}) { const bytes = Buffer.from(JSON.stringify({ ...release, ...change })); return { payload: bytes.toString('base64'), signature: sign(null, bytes, pair.privateKey).toString('base64') }; }
it('accepts only matching, current publisher-authenticated releases', () => {
  expect(verifyRelease(envelope(), { publicKey, channel: 'stable' }, 1, now).sequence).toBe(2);
});
it('rejects tampering and a different publisher', () => {
  const e = envelope(); e.payload = Buffer.from(JSON.stringify({ ...release, version: '9.9.9' })).toString('base64');
  expect(() => verifyRelease(e, { publicKey, channel: 'stable' }, 1, now)).toThrow('signature');
  const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }).toString();
  expect(() => verifyRelease(envelope(), { publicKey: other, channel: 'stable' }, 1, now)).toThrow('signature');
});
it.each([
  [{ sequence: 1 }, 'downgrade'], [{ expiresAt: new Date(now - 1).toISOString() }, 'expired'],
  [{ withdrawn: true }, 'withdrawn'], [{ arch: process.arch === 'arm64' ? 'x64' : 'arm64' }, 'match'],
  [{ minimumUpdater: 2 }, 'Invalid literal'], [{ runtime: { ...release.runtime, url: 'http://insecure.example/file' } }, 'Invalid input'],
])('rejects ineligible metadata %j', (change, error) => {
  expect(() => verifyRelease(envelope(change), { publicKey, channel: 'stable' }, 2, now)).toThrow(error);
});
