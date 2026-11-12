import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { appToolchain, findComputerGit, gitHelp, kitCommandPath, planLaunchers, toolchainPath } from './toolchain';

vi.setConfig({ testTimeout: 60_000 });

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ri-toolchain-'));
function fakeTool(dir: string, name: string, mode = 0o755) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), '#!/bin/sh\necho fake\n', { mode });
  return path.join(dir, name);
}

describe('what Ri carries for apps', () => {
  it('carries a pinned kit, run by the command its package names, and the pnpm that kit writes into every app', () => {
    const tools = appToolchain();
    expect(tools.kit).not.toBeNull();
    const pinned = JSON.parse(fs.readFileSync(path.resolve('packages/app-toolchain/kit/source.json'), 'utf8'));
    expect(tools.kit).toMatchObject({ version: pinned.version, commit: pinned.commit });
    // The kit's create writes this pnpm into each app's packageManager. Carrying the same one means
    // pnpm never fetches another version, so it works without the internet once installed.
    const cli = fs.readFileSync(path.join(path.dirname(tools.kit!.bin), '..', 'dist', 'cli.js'), 'utf8');
    const appPnpm = /packageManager\s*=\s*["']pnpm@([^"']+)["']/.exec(cli)?.[1];
    expect(appPnpm).toBe(pinned.pnpm);
    expect(tools.pnpm?.version).toBe(appPnpm);
  });

  it('runs the carried pnpm and the carried kit with Ri\'s own Node', () => {
    const tools = appToolchain();
    expect(tools.node).toBe(process.execPath);
    const env = { ...process.env, ...tools.env };
    expect(execFileSync(tools.pnpm!.command, ['--version'], { env, encoding: 'utf8' }).trim()).toBe(tools.pnpm!.version);
    expect(execFileSync(tools.node, [tools.kit!.bin, 'create', '--help'], { env, encoding: 'utf8' })).toMatch(/create <new-folder>/);
    // Ri's bin folder and Ri's Node come first, so a kit script's `node` and `pnpm` are Ri's.
    const [bin, nodeDir] = tools.env.PATH.split(path.delimiter);
    expect(bin).toBe(tools.binDir);
    expect(nodeDir).toBe(path.dirname(process.execPath));
    expect(execFileSync('/bin/sh', ['-c', 'command -v pnpm; command -v node'], { env, encoding: 'utf8' }).trim().split('\n'))
      .toEqual([path.join(tools.binDir, 'pnpm'), path.join(path.dirname(process.execPath), 'node')]);
  });

  it('keeps pnpm out of Ri\'s own scripts, which use the developer\'s', () => {
    expect(fs.existsSync(path.resolve('node_modules/.bin/pnpm'))).toBe(false);
  });
});

describe('the computer\'s git', () => {
  it('takes the first git on the PATH that can run', () => {
    const root = scratch();
    fakeTool(path.join(root, 'a'), 'git', 0o644);
    const real = fakeTool(path.join(root, 'b'), 'git');
    expect(findComputerGit({ pathEnv: [path.join(root, 'missing'), path.join(root, 'a'), path.join(root, 'b')].join(path.delimiter) })).toBe(real);
    expect(findComputerGit({ pathEnv: path.join(root, 'a') })).toBeNull();
    expect(findComputerGit({ pathEnv: path.join(root, 'b'), skip: [path.join(root, 'b')] })).toBeNull();
  });

  it('never runs macOS\'s placeholder git, which opens Apple\'s installer, unless the developer tools are there', () => {
    const root = scratch();
    const placeholder = path.join(root, 'usr-bin');
    fs.mkdirSync(placeholder);
    fs.symlinkSync('/usr/bin/git', path.join(placeholder, 'git'));
    const homebrew = fakeTool(path.join(root, 'homebrew'), 'git');
    const pathEnv = [placeholder, path.join(root, 'homebrew')].join(path.delimiter);
    if (!fs.existsSync('/usr/bin/git')) return;
    const asked = vi.fn(() => false);
    expect(findComputerGit({ pathEnv, platform: 'darwin', macToolsInstalled: asked })).toBe(homebrew);
    expect(asked).toHaveBeenCalled();
    expect(findComputerGit({ pathEnv: placeholder, platform: 'darwin', macToolsInstalled: () => false })).toBeNull();
    expect(findComputerGit({ pathEnv: placeholder, platform: 'darwin', macToolsInstalled: () => true })).toBe(path.join(placeholder, 'git'));
    // Elsewhere /usr/bin/git is just git.
    expect(findComputerGit({ pathEnv: placeholder, platform: 'linux', macToolsInstalled: () => false })).toBe(path.join(placeholder, 'git'));
  });

  it('says how to get git, in plain words', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(gitHelp(platform)).toMatch(/git/);
      expect(gitHelp(platform)).not.toMatch(/—|;/);
    }
    expect(gitHelp('darwin')).toContain('xcode-select --install');
  });
});

describe('launchers and PATH', () => {
  it('quotes paths in the launchers it writes', () => {
    const launchers = planLaunchers({ node: "/opt/Ri's app/node", pnpmScript: '/r/pnpm/bin/pnpm.cjs', git: null });
    expect(launchers.pnpm).toContain(`exec '/opt/Ri'\\''s app/node' '/r/pnpm/bin/pnpm.cjs' "$@"`);
    expect(launchers.git).toBeNull();
    expect(planLaunchers({ node: '/n', pnpmScript: null, git: '/usr/local/bin/git' }).git).toContain(`exec '/usr/local/bin/git' "$@"`);
  });

  it('puts Ri\'s bin folder and Node first, once each', () => {
    expect(toolchainPath('/w/bin', '/ri/node/bin/node', ['/usr/bin', '/ri/node/bin', '', '/w/bin', '/bin'].join(path.delimiter)))
      .toBe(['/w/bin', '/ri/node/bin', '/usr/bin', '/bin'].join(path.delimiter));
  });

  it('finds the kit\'s one command without knowing its name', () => {
    expect(kitCommandPath('/k/package.json', { bin: './bin/x.mjs' })).toBe('/k/bin/x.mjs');
    expect(kitCommandPath('/k/package.json', { bin: { anything: './bin/y.mjs' } })).toBe('/k/bin/y.mjs');
    expect(kitCommandPath('/k/package.json', { bin: { a: './a', b: './b' } })).toBeNull();
    expect(kitCommandPath('/k/package.json', {})).toBeNull();
  });
});
