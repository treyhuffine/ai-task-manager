import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { servicePaths } from '../src/lib/service/paths';
import { hasPrivatePermissions } from '../src/lib/config/private-paths';
import { planSessionCli } from '../src/lib/executor/session-cli';
import { signedCliCommand } from '../src/lib/utils/signed-cli-command';
import { bundledCliCommand } from './config';
import { resolveWindowsCmdShim } from '@agentex/agent/utils/binary';
import { ensureSkillSymlink } from '@agentex/agent';

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
it('uses PowerShell syntax for native Windows instructions', () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  expect(signedCliCommand()).toBe('& $env:RI_SESSION_CLI');
  const command = bundledCliCommand('/node with spaces/node.exe', '/server', "/a person's home");
  expect(command).toContain("$env:RI_ROOT='/a person''s home'");
  expect(command).toContain("& '/node with spaces/node.exe'");
});
it.runIf(process.platform === 'win32')('runs the pinned Unicode CLI from a Windows OEM code page', () => {
  const codePage = execFileSync('cmd.exe', ['/d', '/c', 'chcp'], { windowsHide: true, encoding: 'utf8' }).match(/\d+/)![0];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-cli-encoding-'));
  const executable = process.execPath;
  try {
    const node = path.join(root, 'node é.exe');
    fs.copyFileSync(executable, node);
    fs.mkdirSync(path.join(root, 'repo/dist/cli'), { recursive: true });
    fs.writeFileSync(path.join(root, 'repo/dist/cli/index.mjs'), 'console.log(JSON.stringify({node:process.execPath,args:process.argv.slice(2),root:process.env.RI_ROOT}))');
    vi.stubEnv('RI_RUNTIME_REPO', path.join(root, 'repo'));
    vi.stubEnv('RI_ROOT', path.join(root, 'home'));
    vi.stubEnv('RI_WORK_DIR', '');
    Object.defineProperty(process, 'execPath', { value: node });
    const plan = planSessionCli()!;
    Object.defineProperty(process, 'execPath', { value: executable });
    fs.mkdirSync(plan.binDir, { recursive: true }); fs.writeFileSync(plan.launcher, plan.content);
    const child = spawnSync('cmd.exe', ['/d', '/c', `chcp 437 >nul & "${plan.launcher}" agent describe_paths`],
      { windowsVerbatimArguments: true, windowsHide: true, encoding: 'utf8', timeout: 15_000, env: { ...process.env, RI_ROOT: '' } });
    expect(child.status, child.stderr || child.error?.message).toBe(0);
    const result = JSON.parse(child.stdout);
    expect(result.args).toEqual(['agent', 'describe_paths']);
    expect(fs.realpathSync.native(result.node)).toBe(fs.realpathSync.native(node));
    expect(fs.realpathSync.native(result.root)).toBe(fs.realpathSync.native(path.join(root, 'home')));
  } finally {
    Object.defineProperty(process, 'execPath', { value: executable });
    execFileSync('cmd.exe', ['/d', '/c', `chcp ${codePage} >nul`], { windowsHide: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it('resolves npm cmd shims and creates repeatable skill links on the native filesystem', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ri windows dependency '));
  try {
    const entry = path.join(directory, 'entry with spaces.js');
    const shim = path.join(directory, 'tool.cmd');
    fs.writeFileSync(entry, '');
    fs.writeFileSync(shim, '@echo off\r\nnode "%dp0%\\entry with spaces.js" %*\r\n');
    expect(await resolveWindowsCmdShim(shim)).toEqual({ bin: 'node', prefixArgs: [entry] });
    const source = path.join(directory, 'skill');
    const target = path.join(directory, 'linked-skill');
    fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'SKILL.md'), '# Fixture');
    expect(await ensureSkillSymlink(source, target)).toBe('created');
    expect(await ensureSkillSymlink(source, target)).toBe('skipped');
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# Fixture');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
