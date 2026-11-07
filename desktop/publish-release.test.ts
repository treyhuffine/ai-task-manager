import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openEnvelope, promote, publish, refresh, withdraw, writeInstallScript } from './publish-release.mjs';
import { ReleaseSchema, verifyRelease } from '../src/lib/service/release-trust';
import { CURRENT_COMPATIBILITY } from '../src/lib/releases/compatibility';

let root: string;
const { privateKey } = generateKeyPairSync('ed25519');
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
const now = Date.parse('2026-11-07T12:00:00Z');
const hash = (letter: string) => letter.repeat(64);
const payload = (version: string, platform = process.platform, arch = process.arch) => ({
  version, platform, arch, minimumUpdater: 1, apiProtocol: 1, configFormat: 1, migrationHistory: hash('b'),
  runtime: { id: hash('a'), url: `https://example.test/v${version}/runtime.tar.gz`, sha256: hash('c'), size: 100, unpackedSize: 1000 },
  compatibility: CURRENT_COMPATIBILITY,
});
const open = (folder: string, name: string) => JSON.parse(fs.readFileSync(path.join(folder, `${name}-${process.platform}-${process.arch}.json`), 'utf8'));

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-publish-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

it('writes a file per channel and version that a client accepts', () => {
  publish({ payloads: [payload('0.2.0')], channel: 'latest', key: privateKey, out: root, sequence: 5, now, notes: 'What changed' });
  const release = verifyRelease(open(root, 'latest'), { publicKey, channel: 'latest' }, 0, now);
  expect(ReleaseSchema.parse(release)).toMatchObject({ version: '0.2.0', channel: 'latest', sequence: 5, withdrawn: false, notes: 'What changed' });
  expect(verifyRelease(open(root, '0.2.0'), { publicKey, channel: 'latest' }, 0, now).version).toBe('0.2.0');
  expect(fs.existsSync(path.join(root, `stable-${process.platform}-${process.arch}.json`))).toBe(false);
});

it('puts a stable release on latest too, since latest gets every release', () => {
  publish({ payloads: [payload('0.2.0')], channel: 'stable', key: privateKey, out: root, sequence: 5, now });
  expect(verifyRelease(open(root, 'stable'), { publicKey, channel: 'stable' }, 0, now).version).toBe('0.2.0');
  expect(verifyRelease(open(root, 'latest'), { publicKey, channel: 'latest' }, 0, now).version).toBe('0.2.0');
});

it('refuses to publish a version twice, since a client that has it wouldn\'t move', () => {
  publish({ payloads: [payload('0.2.0')], channel: 'latest', key: privateKey, out: root, sequence: 5, now });
  expect(() => publish({ payloads: [payload('0.2.0')], channel: 'latest', key: privateKey, out: path.join(root, 'next'), existing: root, sequence: 6, now })).toThrow('already published');
});

it('keeps a signed index of versions, newest first, for finding a bridge', () => {
  publish({ payloads: [payload('0.2.0')], channel: 'latest', key: privateKey, out: root, sequence: 5, now });
  const next = path.join(root, 'next');
  publish({ payloads: [payload('0.10.0')], channel: 'latest', key: privateKey, out: next, existing: root, sequence: 6, now });
  expect(openEnvelope(open(next, 'index'), publicKey).versions.map((item: { version: string }) => item.version)).toEqual(['0.10.0', '0.2.0']);
});

it('refuses an existing feed signed by another key', () => {
  publish({ payloads: [payload('0.2.0')], channel: 'latest', key: privateKey, out: root, sequence: 5, now });
  const other = generateKeyPairSync('ed25519').privateKey;
  expect(() => publish({ payloads: [payload('0.3.0')], channel: 'latest', key: other, out: path.join(root, 'next'), existing: root, sequence: 6, now })).toThrow('bad signature');
});

it('promotes a version to stable with a newer sequence', () => {
  publish({ payloads: [payload('0.2.0')], channel: 'latest', key: privateKey, out: root, sequence: 5, now });
  const next = path.join(root, 'next');
  expect(promote({ existing: root, version: '0.2.0', key: privateKey, out: next, sequence: 6, now })).toBe(1);
  expect(verifyRelease(open(next, 'stable'), { publicKey, channel: 'stable' }, 5, now)).toMatchObject({ version: '0.2.0', sequence: 6 });
  expect(() => promote({ existing: root, version: '9.9.9', key: privateKey, out: next, sequence: 7, now })).toThrow('not on this feed');
});

it('refreshes the expiry, so a client past the old one still accepts it, and changes nothing else', () => {
  publish({ payloads: [payload('0.2.0')], channel: 'latest', key: privateKey, out: root, sequence: 5, now, days: 1 });
  const later = now + 5 * 86_400_000;
  expect(() => verifyRelease(open(root, 'latest'), { publicKey, channel: 'latest' }, 0, later)).toThrow('expired');
  const next = path.join(root, 'next');
  refresh({ existing: root, key: privateKey, out: next, now: later, days: 30 });
  expect(verifyRelease(open(next, 'latest'), { publicKey, channel: 'latest' }, 0, later)).toMatchObject({ version: '0.2.0', sequence: 5 });
  expect(openEnvelope(open(next, 'index'), publicKey).versions).toHaveLength(1);
});

it('withdraws a version, so a client refuses it', () => {
  publish({ payloads: [payload('0.2.0')], channel: 'latest', key: privateKey, out: root, sequence: 5, now });
  const next = path.join(root, 'next');
  expect(withdraw({ existing: root, version: '0.2.0', key: privateKey, out: next, sequence: 6, now })).toBe(2);
  expect(() => verifyRelease(open(next, 'latest'), { publicKey, channel: 'latest' }, 0, now)).toThrow('withdrawn');
});

it('writes this feed and its key into the install script', () => {
  const template = path.join(root, 'template.sh');
  fs.writeFileSync(template, 'FEED="__RI_FEED__"\nKEY="__RI_PUBLIC_KEY_BASE64__"\n');
  writeInstallScript({ template, feed: 'https://example.test/feed/', key: privateKey, out: root });
  const script = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
  expect(script).toContain('FEED="https://example.test/feed/"');
  expect(Buffer.from(/KEY="([^"]+)"/.exec(script)![1], 'base64').toString()).toBe(publicKey);
  expect(script).not.toContain('PRIVATE');
});

it('promotes exactly the version named, not a prerelease of it', () => {
  publish({ payloads: [payload('0.2.0-rc.1')], channel: 'latest', key: privateKey, out: root, sequence: 5, now });
  publish({ payloads: [payload('0.2.0')], channel: 'latest', key: privateKey, out: root, sequence: 6, now });
  const out = path.join(root, 'next');
  expect(promote({ existing: root, version: '0.2.0', key: privateKey, out, sequence: 7, now })).toBe(1);
  expect(verifyRelease(open(out, 'stable'), { publicKey, channel: 'stable' }, 0, now).version).toBe('0.2.0');
});

