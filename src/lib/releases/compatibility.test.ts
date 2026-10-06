import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { CURRENT_COMPATIBILITY as current, legacyCompatibility, negotiateWorker, localFormatReasons, compatibilityMessage } from './compatibility';
import { pinServedRelease, runtimePeerRelease, runtimeReleaseIdentity, runtimeRepository, workerUpdateCompatibility, readRuntimeCompatibility } from './runtime-identity';
import { createRuntimeManifest, verifyRuntime } from '@/lib/service/runtime';
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); globalThis.__riServedRelease = undefined; for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function temporary() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-compatibility-')); roots.push(root); return root; }
it('bridges the protocol-4 release in either direction without pretending protocol 3 works', () => {
  expect(negotiateWorker(current, legacyCompatibility(4))).toMatchObject({ compatible: true, protocol: 4, capabilities: ['worker.protocol4'] });
  expect(negotiateWorker(legacyCompatibility(4), current)).toMatchObject({ compatible: true, protocol: 4 });
  expect(negotiateWorker(current, legacyCompatibility(3))).toMatchObject({ compatible: false, update: 'worker' });
  expect(negotiateWorker(legacyCompatibility(3), current)).toMatchObject({ compatible: false, update: 'home' });
});
it('negotiates overlap and required capabilities, independently of version strings', () => {
  const bridge = { ...current, workerProtocols: [4, 5] };
  expect(negotiateWorker(bridge, current)).toMatchObject({ compatible: true, protocol: 4 });
  expect(negotiateWorker(current, bridge)).toMatchObject({ compatible: true, protocol: 4 });
  const next = { ...bridge, requiredCapabilities: [...current.requiredCapabilities, 'new-operation.v1'] };
  expect(negotiateWorker(next, current)).toMatchObject({ compatible: false, update: 'worker' });
  expect(negotiateWorker(current, next)).toMatchObject({ compatible: false, update: 'home' });
});
it('names the side that needs updating', () => {
  const result = negotiateWorker(current, { ...current, workerProtocols: [99] });
  expect(result.compatible).toBe(false);
  if (!result.compatible) expect(compatibilityMessage(result, 'MacBook', 'Mini')).toMatch(/^Update Ri on Mini/);
});
it('keeps old journals readable and refuses an unqualified format change', () => {
  expect(localFormatReasons(current)).toEqual([]);
  expect(localFormatReasons({ ...current, journal: { ...current.journal, events: { read: [2], write: 2 } } })).toHaveLength(2);
  const repo = temporary();
  expect(workerUpdateCompatibility(repo)[0]).toMatch(/bridge/);
  fs.writeFileSync(path.join(repo, 'ri-compatibility.json'), JSON.stringify(current));
  expect(workerUpdateCompatibility(repo)).toEqual([]);
});
it('uses the actual packaged identity and inventory-authenticated compatibility with the old envelope', () => {
  const root = temporary();
  for (const file of ['node/bin/node', 'server/package.json', 'server/dist/service/main.cjs', 'server/dist/service/http-server.cjs', 'server/dist/service/handoff.cjs', 'server/dist/service/runtime-job.cjs', 'server/dist/cli/index.mjs']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), file.endsWith('package.json') ? '{"version":"9.8.7"}' : file);
  }
  const manifest = createRuntimeManifest(root);
  vi.stubEnv('npm_package_version', 'wrong');
  expect(runtimeReleaseIdentity(path.join(root, 'server'))).toEqual({ version: '9.8.7', build: manifest.id, source: 'packaged' });
  expect(readRuntimeCompatibility(path.join(root, 'server'))).toEqual(current);
  expect(verifyRuntime(root).id).toBe(manifest.id);
  fs.writeFileSync(path.join(root, 'server/ri-compatibility.json'), JSON.stringify({ ...current, workerProtocols: [99] }));
  expect(() => verifyRuntime(root)).toThrow(/files do not match/);
});

it('keeps naming the served build while the checkout is rebuilt under the server', () => {
  const repo = temporary();
  const buildId = path.join(repo, '.next', 'BUILD_ID');
  fs.mkdirSync(path.dirname(buildId), { recursive: true });
  fs.writeFileSync(buildId, 'served\n');
  vi.stubEnv('RI_RUNTIME_REPO', repo);
  vi.stubEnv('NEXT_DIST_DIR', '.next');
  expect(runtimeReleaseIdentity().build).toBe('source:served');
  expect(pinServedRelease().release.build).toBe('source:served');
  // `next build` first clears the dist dir, then writes a new id.
  fs.rmSync(buildId);
  expect(runtimeReleaseIdentity().build).toBe('source:served');
  fs.writeFileSync(buildId, 'rebuilt\n');
  expect(runtimeReleaseIdentity().build).toBe('source:served');
  expect(runtimePeerRelease()).toBe(pinServedRelease());
  // An explicit installation is read as it is on disk now.
  expect(runtimeReleaseIdentity(repo).build).toBe('source:rebuilt');
  expect(runtimePeerRelease(repo).release.build).toBe('source:rebuilt');
});

it('finds the packaged desktop setup release independently of Electron working directory', () => {
  const entry = process.argv[1];
  vi.stubEnv('RI_RUNTIME_REPO', '');
  try {
    process.argv[1] = '/Applications/Ri.app/Contents/Resources/server/dist/desktop/connection-setup-entry.cjs';
    expect(runtimeRepository()).toBe('/Applications/Ri.app/Contents/Resources/server');
  } finally { process.argv[1] = entry; }
});
