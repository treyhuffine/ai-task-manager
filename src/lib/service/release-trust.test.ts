import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promote, publish } from '../../../desktop/publish-release.mjs';
import { checkRelease, checkReleaseVersion, releasePolicyFile, secureFetch } from './release-trust';
import { writeOrigin } from './origin';

let root: string;
let feed: string;
const { privateKey } = generateKeyPairSync('ed25519');
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
const hash = (letter: string) => letter.repeat(64);
const payload = (version: string, id: string) => ({
  version, platform: process.platform, arch: process.arch, minimumUpdater: 1, apiProtocol: 1, configFormat: 1, migrationHistory: hash('b'),
  runtime: { id: hash(id), url: `https://feed.test/v${version}/runtime.tar.gz`, sha256: hash('c'), size: 100, unpackedSize: 1000 },
});
const publishTo = (version: string, id: string, channel: 'stable' | 'latest', sequence: number) => publish({ payloads: [payload(version, id)], channel, key: privateKey, out: feed, sequence });
const promoteTo = (version: string, sequence: number) => promote({ existing: feed, version, key: privateKey, out: feed, sequence });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-release-trust-'));
  feed = path.join(root, 'feed');
  vi.stubEnv('RI_ROOT', path.join(root, 'home')); vi.stubEnv('RI_INSTALL_ROOT', path.join(root, 'installed'));
  fs.mkdirSync(path.join(root, 'installed'), { recursive: true });
  fs.writeFileSync(releasePolicyFile(), JSON.stringify({ format: 1, feed: 'https://feed.test/', publicKey }));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const file = path.join(feed, path.basename(new URL(url).pathname));
    return fs.existsSync(file) ? new Response(fs.readFileSync(file)) : new Response('', { status: 404 });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); fs.rmSync(root, { recursive: true, force: true }); });

it('lets a computer on stable fetch a release promoted after it was published', async () => {
  publishTo('0.2.0', 'a', 'latest', 10);
  promoteTo('0.2.0', 20);
  expect((await checkRelease()).sequence).toBe(20);
  // The file for the version itself still carries the sequence it was published with.
  const version = await checkReleaseVersion('0.2.0');
  expect(version).toMatchObject({ version: '0.2.0', sequence: 10 });
});

it('keeps a separate order for each channel, since stable is often behind latest', async () => {
  publishTo('0.2.0', 'a', 'latest', 10);
  promoteTo('0.2.0', 20);
  await checkRelease();
  publishTo('0.3.0', 'b', 'latest', 15);
  writeOrigin({ channel: 'latest' });
  expect((await checkRelease()).version).toBe('0.3.0');
  writeOrigin({ channel: 'stable' });
  expect((await checkRelease()).version).toBe('0.2.0');
});

it('refuses a channel moved backwards', async () => {
  publishTo('0.3.0', 'b', 'stable', 20);
  await checkRelease();
  publishTo('0.2.0', 'a', 'stable', 10);
  await expect(checkRelease()).rejects.toThrow('downgrade');
});

it('refuses a version that was published under another key', async () => {
  publishTo('0.2.0', 'a', 'stable', 10);
  fs.writeFileSync(releasePolicyFile(), JSON.stringify({ format: 1, feed: 'https://feed.test/', publicKey: createPublicKey(generateKeyPairSync('ed25519').privateKey).export({ type: 'spki', format: 'pem' }).toString() }));
  await expect(checkReleaseVersion('0.2.0')).rejects.toThrow('signature');
});

it('gives up on a download only when it stops moving, not when it takes a long time', async () => {
  let push!: (chunk: Uint8Array) => void; let close!: () => void;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { signal: AbortSignal }) => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      push = chunk => controller.enqueue(chunk); close = () => controller.close();
      init.signal.addEventListener('abort', () => controller.error(init.signal.reason));
    },
  }))));
  const steady = await secureFetch('https://feed.test/runtime.tar.gz', 80);
  const reading = steady.arrayBuffer();
  // Six times the stall limit in total, with bytes arriving throughout.
  for (let i = 0; i < 12; i++) { await new Promise(resolve => setTimeout(resolve, 40)); push(new Uint8Array([i])); }
  close();
  expect((await reading).byteLength).toBe(12);

  const stuck = await secureFetch('https://feed.test/runtime.tar.gz', 80);
  push(new Uint8Array([1]));
  await expect(stuck.arrayBuffer()).rejects.toThrow('stopped moving');
});
