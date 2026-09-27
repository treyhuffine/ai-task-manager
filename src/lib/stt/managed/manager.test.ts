import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ManagedSpeech, speechPaths } from './manager';
import { clearMaintenance, writeMaintenance } from '@/lib/service/maintenance';
const fixture = vi.hoisted(() => ({ bytes: 'small pinned model' }));
vi.mock('./model', async () => {
  const { createHash } = await import('node:crypto');
  return { PARAKEET_BYTES: fixture.bytes.length, PARAKEET_REVISION: 'test-revision', PARAKEET_FILES: [{ name: 'test.onnx', size: fixture.bytes.length, sha256: createHash('sha256').update(fixture.bytes).digest('hex') }], modelUrl: () => 'https://model.example/test' };
});
let root: string;
let manager: ManagedSpeech;
const realFetch = fetch;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-managed-speech-test-'));
  vi.stubEnv('RI_ROOT', path.join(root, 'home'));
  const helper = path.join(root, 'helper'); fs.writeFileSync(helper, 'unused helper');
  vi.stubEnv('RI_SPEECH_HELPER', helper);
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url, options) => String(url).startsWith('https://model.example') ? Promise.resolve(new Response(fixture.bytes)) : realFetch(url, options)));
  manager = new ManagedSpeech();
});
afterEach(async () => { clearMaintenance(); await manager.dispose(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); fs.rmSync(root, { recursive: true, force: true }); });
async function settled() {
  for (let count = 0; count < 1000; count++) {
    if (!['downloading', 'verifying'].includes(manager.status().phase)) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Install did not finish');
}
it('installs only after opt-in and removes only its model cache', async () => {
  expect(manager.status()).toMatchObject({ installed: false, enabled: false, cloudFallback: false });
  expect(fetch).not.toHaveBeenCalled();
  manager.install(); await settled();
  expect(manager.status()).toMatchObject({ installed: true, enabled: true, phase: 'installed' });
  fs.writeFileSync(path.join(speechPaths().root, 'unrelated'), 'keep');
  await manager.uninstall();
  expect(manager.status()).toMatchObject({ installed: false, enabled: false });
  expect(fs.readFileSync(path.join(speechPaths().root, 'unrelated'), 'utf8')).toBe('keep');
});
it('repairs damaged model bytes and reuses complete verified data', async () => {
  manager.install(); await settled(); vi.mocked(fetch).mockClear();
  manager.install(); await settled(); expect(fetch).not.toHaveBeenCalled();
  fs.writeFileSync(path.join(speechPaths().model, 'test.onnx'), 'damaged');
  manager.install(); await settled(); expect(fetch).toHaveBeenCalledOnce();
  expect(createHash('sha256').update(fs.readFileSync(path.join(speechPaths().model, 'test.onnx'))).digest('hex')).toBe(createHash('sha256').update(fixture.bytes).digest('hex'));
});
it('rejects concurrent lifecycle changes and leaves resumable state on cancel', async () => {
  vi.mocked(fetch).mockImplementation(async (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')))));
  manager.install();
  expect(() => manager.configure({ enabled: false })).toThrow('current local speech operation');
  const removing = manager.uninstall();
  expect(() => manager.install()).toThrow('being removed');
  await removing;
  expect(manager.status()).toMatchObject({ installed: false, enabled: false });
});
it('blocks model/configuration mutations during update maintenance', async () => {
  writeMaintenance({ phase: 'draining', token: 'test', startedAt: new Date().toISOString() });
  expect(() => manager.install()).toThrow('preparing an update');
  expect(() => manager.configure({ cloudFallback: true })).toThrow('preparing an update');
  await expect(manager.uninstall()).rejects.toThrow('preparing an update');
});
it('holds a crash-released ownership lock across managers', async () => {
  manager.configure({ cloudFallback: true });
  const second = new ManagedSpeech();
  expect(() => second.configure({ cloudFallback: false })).toThrow('Another Ri backend');
  await manager.dispose();
  expect(second.configure({ cloudFallback: false }).cloudFallback).toBe(false);
  await second.dispose();
});
it('refuses to install when a build has no helper', () => {
  vi.stubEnv('RI_SPEECH_HELPER', path.join(root, 'absent'));
  expect(() => manager.install()).toThrow('does not include');
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects an already cancelled transcription without spawning a helper', async () => {
  manager.install(); await settled();
  const cancel = new AbortController(); cancel.abort();
  await expect(manager.transcribe(new Blob(['recording']), cancel.signal)).rejects.toThrow();
  expect(manager.status().phase).toBe('installed');
});
