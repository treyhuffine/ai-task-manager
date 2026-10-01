import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { assertDesktopPackagingRuntime, DESKTOP_NODE_VERSION } from './package-preflight.mjs';

it.each(['darwin', 'linux'] as const)('supports both package architectures on %s using the pinned runtime', platform => {
  for (const arch of ['arm64', 'x64']) expect(() => assertDesktopPackagingRuntime({ platform, arch, nodeVersion: DESKTOP_NODE_VERSION })).not.toThrow();
  expect(fs.readFileSync(path.resolve(__dirname, '../.nvmrc'), 'utf8').trim()).toBe(DESKTOP_NODE_VERSION);
});

it.each(['24.2.0', '26.4.0', '26.5.1'])('rejects Node %s instead of mixing native module ABIs', nodeVersion => {
  expect(() => assertDesktopPackagingRuntime({ platform: 'darwin', arch: 'arm64', nodeVersion })).toThrow(/Build with pinned Node 26\.5\.0/);
});

it('rejects unsupported operating systems and architectures', () => {
  expect(() => assertDesktopPackagingRuntime({ platform: 'win32', arch: 'x64', nodeVersion: DESKTOP_NODE_VERSION })).toThrow(/matching macOS\/Linux/);
  expect(() => assertDesktopPackagingRuntime({ platform: 'linux', arch: 'ia32', nodeVersion: DESKTOP_NODE_VERSION })).toThrow(/matching macOS\/Linux/);
});

it.each([
  { property: 'node', value: '24.2.0', message: 'Build with pinned Node 26.5.0' },
  { property: 'platform', value: 'win32', message: 'Build on the matching macOS/Linux arm64/x64 host.' },
])('the real package entrypoint rejects $property before writing or building', ({ property, value, message }) => {
  // Run the actual entrypoint with mutation/build tripwires. A late guard
  // fails this test safely before it can create artifacts or start pnpm.
  const preload = `
    import fs from 'node:fs';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    Object.defineProperty(${property === 'node' ? 'process.versions' : 'process'}, ${JSON.stringify(property)}, { value: ${JSON.stringify(value)} });
    const refuse = () => { throw new Error('PACKAGING_SIDE_EFFECT_BEFORE_PREFLIGHT'); };
    for (const name of ['mkdirSync', 'mkdtempSync', 'writeFileSync', 'copyFileSync', 'cpSync', 'renameSync', 'rmSync', 'createWriteStream']) fs[name] = refuse;
    for (const name of ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec', 'fork']) childProcess[name] = refuse;
    globalThis.fetch = refuse;
    syncBuiltinESMExports();
  `;
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, path.resolve(__dirname, 'package.mjs')], {
    env, encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(message);
  expect(result.stdout + result.stderr).not.toContain('PACKAGING_SIDE_EFFECT_BEFORE_PREFLIGHT');
});
