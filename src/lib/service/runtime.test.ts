import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRuntimeManifest, installedRuntime, stageRuntime, verifyRuntime } from './runtime';
import { serviceDefinition } from './install';

let temporary: string;
let resources: string;
beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-runtime-test-'));
  resources = path.join(temporary, 'resources');
  vi.stubEnv('RI_ROOT', path.join(temporary, 'home'));
  vi.stubEnv('RI_INSTALL_ROOT', path.join(temporary, 'installed'));
  for (const file of ['node/bin/node', 'server/dist/service/main.cjs', 'server/dist/service/http-server.cjs', 'server/dist/service/handoff.cjs', 'server/dist/service/runtime-job.cjs', 'server/dist/cli/index.mjs']) {
    fs.mkdirSync(path.dirname(path.join(resources, file)), { recursive: true });
    fs.writeFileSync(path.join(resources, file), file);
  }
  fs.chmodSync(path.join(resources, 'node/bin/node'), 0o755);
  fs.writeFileSync(path.join(resources, 'server/package.json'), '{"version":"0.1.0"}');
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(temporary, { recursive: true, force: true }); });

it('stages a complete runtime that survives the source app being removed', () => {
  const manifest = createRuntimeManifest(resources);
  const installed = stageRuntime(resources);
  fs.rmSync(resources, { recursive: true });
  expect(installed.id).toBe(manifest.id);
  expect(verifyRuntime(installed.directory).id).toBe(manifest.id);
  expect(fs.readFileSync(installed.launcher, 'utf8')).toContain('active-release');
});

it('detects file changes, extra files, and escaped symlinks', () => {
  createRuntimeManifest(resources);
  fs.writeFileSync(path.join(resources, 'server/injected.js'), 'changed');
  expect(() => verifyRuntime(resources)).toThrow('do not match');
  fs.unlinkSync(path.join(resources, 'server/injected.js'));
  fs.symlinkSync('/etc/hosts', path.join(resources, 'server/escape'));
  expect(() => createRuntimeManifest(resources)).toThrow('escapes');
});

it('stages another version without changing the active runtime', () => {
  createRuntimeManifest(resources);
  const first = stageRuntime(resources);
  fs.writeFileSync(path.join(resources, 'server/package.json'), '{"version":"0.2.0"}');
  const newer = createRuntimeManifest(resources);
  stageRuntime(resources);
  expect(installedRuntime()?.id).toBe(first.id);
  expect(newer.id).not.toBe(first.id);
});

it('generates user services with literal escaped paths and bounded restarts', () => {
  const common = { home: '/tmp/user', launcher: '/tmp/a & "b"/launch', id: '123', root: '/tmp/root', database: '/tmp/root/data.db', config: '/tmp/root/.config', work: '/tmp/root/.work', log: '/tmp/root/service.log' };
  const mac = serviceDefinition({ ...common, platform: 'darwin' });
  expect(mac.content).toContain('/tmp/a &amp; &quot;b&quot;/launch');
  expect(mac.content).toContain('<key>SuccessfulExit</key><false/>');
  expect(mac.file).toContain('/Library/LaunchAgents/');
  const linux = serviceDefinition({ ...common, platform: 'linux' });
  expect(linux.content).toContain('Restart=on-failure');
  expect(linux.content).toContain('KillMode=control-group');
  expect(linux.content).not.toContain('User=root');
});
