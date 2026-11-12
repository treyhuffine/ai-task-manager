import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as q from '@/lib/db/queries';
import { AppBuildError, appBuildSettings, foldKitLine, kitCliFor, setAppBuildSettings, type AppJob } from './builder';
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
