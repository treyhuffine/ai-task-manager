import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import * as q from '@/lib/db/queries';
import { AppBuildError, appBuildSettings, createApp, foldKitLine, kitCliFor, setAppBuildSettings, type AppJob } from './builder';
import { appToolchain } from './toolchain';

vi.setConfig({ testTimeout: 60_000 });
import { renderAppBuilderBrief } from './builder-brief';

describe('reading the kit', () => {
  it('folds its --json progress lines and result into a job, ignoring anything else', () => {
    const job: Pick<AppJob, 'steps' | 'result'> = { steps: [] };
    for (const line of [
      '{"event":"step","step":"resolve","status":"started"}',
      '{"event":"step","step":"resolve","status":"passed","detail":"3f2a9c1d0b7e"}',
      'not json',
      '{"event":"step","step":"test","status":"failed"}',
      '{"event":"step","step":"build","status":"bogus"}',
      '{"event":"result","outcome":"checks_failed","message":"Tests failed. Nothing changed.","log":"/data/releases/change.log"}',
    ]) foldKitLine(job, line);
    expect(job.steps).toEqual([{ step: 'resolve', status: 'passed', detail: '3f2a9c1d0b7e' }, { step: 'test', status: 'failed' }]);
    expect(job.result).toEqual({ outcome: 'checks_failed', message: 'Tests failed. Nothing changed.', log: '/data/releases/change.log' });
  });

  it('finds the kit command an app uses from its own start script, never assuming a name', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-app-'));
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ scripts: { start: 'some-kit serve' } }));
    expect(kitCliFor(folder)).toBe('some-kit');
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
    expect(() => kitCliFor(folder)).toThrow(AppBuildError);
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ scripts: { start: 'kit; rm -rf / serve' } }));
    expect(() => kitCliFor(folder)).toThrow(AppBuildError);
  });
});

describe('settings', () => {
  it('defaults the apps folder under Ri\'s home and takes only full paths', () => {
    expect(appBuildSettings().appsDir).toBe(appBuildSettings().defaultAppsDir);
    expect(appBuildSettings().defaultAppsDir.endsWith(`${path.sep}apps`)).toBe(true);
    expect(() => setAppBuildSettings({ appsDir: 'relative/apps' })).toThrow(AppBuildError);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-apps-'));
    expect(setAppBuildSettings({ appsDir: dir, appKitCommand: 'pnpm --dir /kit create:app' })).toMatchObject({ appsDir: dir, appKitCommand: 'pnpm --dir /kit create:app' });
    expect(setAppBuildSettings({ appsDir: null, appKitCommand: null })).toMatchObject({ appKitCommand: null });
  });
});

describe('what Ri brings', () => {
  it('reports the carried kit and pnpm, and Ri\'s own Node', () => {
    const { tools } = appBuildSettings();
    expect(tools.node).toBe(process.version);
    expect(tools.kit?.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(tools.pnpm).toMatch(/^\d+\.\d+\.\d+/);
    // How to get git shows only when there's none.
    expect(!!tools.gitHelp).toBe(!tools.git);
  });

  it('runs a kit command with Ri\'s toolchain first on its PATH, and gives the new repository a name to commit with', async () => {
    const apps = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-apps-'));
    const seen = path.join(apps, 'seen-path');
    // A stand-in for a kit checkout's create (the developer override): it records its PATH and makes an app.
    const kit = path.join(apps, 'fake-create.sh');
    fs.writeFileSync(kit, `#!/bin/sh\nprintf '%s' "$PATH" > ${JSON.stringify(seen)}\nmkdir -p "$1"\necho '{"name":"tide-log","scripts":{"start":"kit serve"}}' > "$1/package.json"\n`, { mode: 0o755 });
    setAppBuildSettings({ appsDir: apps, appKitCommand: kit });
    // Someone without developer tools has no git identity.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-git-home-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('XDG_CONFIG_HOME', home);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    try {
      const source = await createApp({ name: 'Tide Log' });
      const tools = appToolchain();
      expect(fs.readFileSync(seen, 'utf8').split(path.delimiter).slice(0, 2)).toEqual([tools.binDir, path.dirname(process.execPath)]);
      const log = execFileSync('git', ['log', '--format=%an %s'], { cwd: source.folder!, encoding: 'utf8' }).trim();
      expect(log).toBe('Ri Create Tide Log from the app kit');
      // The builder's own commits work there too.
      expect(execFileSync('git', ['config', 'user.email'], { cwd: source.folder!, encoding: 'utf8' }).trim()).toBe('ri@localhost');
    } finally {
      vi.unstubAllEnvs();
      setAppBuildSettings({ appsDir: null, appKitCommand: null });
    }
  });
});

describe('the builder brief', () => {
  it('keeps to host facts: the folder, checks on their own data, how to check, and what never to do', () => {
    const source = q.createAppSource({ name: 'Bloom', folder: '/apps/bloom', createdByRi: true });
    const brief = renderAppBuilderBrief(source.id);
    expect(brief).toContain('/apps/bloom');
    expect(brief).toContain('APP_CONNECTORS=fixtures');
    expect(brief).toContain('pnpm run typecheck');
    expect(brief).toMatch(/never connect it to Ri/i);
    q.updateAppSource(source.id, { url: 'http://127.0.0.1:4500/mcp', changeFolder: '/work/bloom-change', changeBranch: 'change/1' });
    const change = renderAppBuilderBrief(source.id);
    expect(change).toContain('/work/bloom-change');
    expect(change).toContain('change/1');
    expect(change).toContain('Never edit that folder');
    expect(change).not.toMatch(/—|;/);
  });
});
