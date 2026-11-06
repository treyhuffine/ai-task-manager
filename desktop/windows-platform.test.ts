import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { servicePaths } from '../src/lib/service/paths';
import { hasPrivatePermissions } from '../src/lib/config/private-paths';
import { planSessionCli } from '../src/lib/executor/session-cli';

const platform = process.platform;
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }); vi.unstubAllEnvs(); });
it('uses a Windows named pipe with the same identity on each call', () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  expect(servicePaths().socket).toMatch(/^\\\\\.\\pipe\\ri-[a-f0-9]{24}$/);
  expect(servicePaths().socket).toBe(servicePaths().socket);
});
it('does not treat Windows synthetic POSIX modes as an ACL', () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  expect(hasPrivatePermissions({ mode: 0o666 } as fs.Stats)).toBe(true);
  Object.defineProperty(process, 'platform', { value: 'linux' });
  expect(hasPrivatePermissions({ mode: 0o666 } as fs.Stats)).toBe(false);
});
it('writes a cmd launcher that pins this Home and forwards arguments', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-windows-cli-'));
  try {
    fs.mkdirSync(path.join(repo, 'dist/cli'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'dist/cli/index.mjs'), '');
    vi.stubEnv('RI_RUNTIME_REPO', repo);
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const plan = planSessionCli()!;
    expect(plan.launcher).toMatch(/ri\.cmd$/);
    expect(plan.content).toContain('if not defined RI_ROOT (');
    expect(plan.content).toContain(' %*\r\nexit /b %errorlevel%');
    expect(plan.content).toContain('setlocal');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
