import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { createTwoComputerLayout, git, type TwoComputerLayout } from '@/test/fixtures/git';
import { applyAdoption, planAdoption } from './adopt';
import { readSetupFile, SETUP_FILE, SetupFileConflictError, writeSetupFile } from './local-file';

/**
 * Adoption moves the home computer's existing folder choices from the
 * database into setup files, and changes nothing else (docs/homes-spec.md
 * §10.1). Planning only reads.
 */

let layout: TwoComputerLayout;
let home: TestHome;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-adopt-' });
  layout = createTwoComputerLayout();
});

afterEach(async () => {
  layout.cleanup();
  await home.cleanup();
});

const refs = {
  app: [
    { alias: 'agentex', path: '/abs/agentex', targetWorkspaceId: null },
    { alias: 'lib', path: null, targetWorkspaceId: 'agent-lib' },
  ],
};

describe('planAdoption', () => {
  it('plans a setup file per folder with each agent and its stored references, writing nothing', () => {
    const plan = planAdoption({
      homeId: 'home-1',
      agents: [{ id: 'agent-app', name: 'App', cwd: layout.mini.app }],
      referencesFor: () => refs.app,
    });
    expect(plan.steps).toEqual([
      {
        kind: 'create',
        dir: layout.mini.app,
        agents: ['agent-app'],
        file: {
          version: 1,
          homeId: 'home-1',
          agents: { 'agent-app': { references: { agentex: '/abs/agentex', lib: { agentId: 'agent-lib' } } } },
        },
      },
    ]);
    expect(fs.existsSync(path.join(layout.mini.app, SETUP_FILE))).toBe(false);
  });

  it('puts agents that share a folder in one file', () => {
    const plan = planAdoption({
      homeId: 'home-1',
      agents: [
        { id: 'a', name: 'A', cwd: layout.mini.app },
        { id: 'b', name: 'B', cwd: layout.mini.app + '/' },
      ],
      referencesFor: () => [],
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ kind: 'create', agents: ['a', 'b'] });
  });

  it('adds to a setup file for the same home, and only registers agents already in it', () => {
    writeSetupFile(layout.mini.app, { version: 1, homeId: 'home-1', agents: { a: { references: {} } } }, null);
    const plan = planAdoption({
      homeId: 'home-1',
      agents: [
        { id: 'a', name: 'A', cwd: layout.mini.app },
        { id: 'b', name: 'B', cwd: layout.mini.app },
      ],
      referencesFor: () => [],
    });
    expect(plan.steps[0]).toMatchObject({ kind: 'add', agents: ['b'] });

    const only = planAdoption({ homeId: 'home-1', agents: [{ id: 'a', name: 'A', cwd: layout.mini.app }], referencesFor: () => [] });
    expect(only.steps[0]).toMatchObject({ kind: 'register', agents: ['a'] });
  });

  it('skips, with a reason, a missing folder, another home, or a broken file, and agents already set up', () => {
    fs.writeFileSync(path.join(layout.mini.agentex, SETUP_FILE), '{ broken');
    writeSetupFile(layout.macbook.app, { version: 1, homeId: 'someone-else', agents: {} }, null);
    const plan = planAdoption({
      homeId: 'home-1',
      agents: [
        { id: 'gone', name: 'Gone', cwd: '/nowhere/at/all' },
        { id: 'broken', name: 'Broken', cwd: layout.mini.agentex },
        { id: 'foreign', name: 'Foreign', cwd: layout.macbook.app },
        { id: 'done', name: 'Done', cwd: layout.mini.app },
      ],
      referencesFor: () => [],
      alreadySetUp: new Set(['done']),
    });
    const kinds = Object.fromEntries(plan.steps.map((s) => [s.agents[0], s]));
    expect(kinds.gone).toMatchObject({ kind: 'skip', reason: expect.stringMatching(/doesn't exist/) });
    expect(kinds.broken).toMatchObject({ kind: 'skip', reason: expect.stringMatching(/not valid JSON/) });
    expect(kinds.foreign).toMatchObject({ kind: 'skip', reason: expect.stringMatching(/different Ri home/) });
    expect(kinds.done).toBeUndefined();
  });
});

describe('applyAdoption', () => {
  it('writes and registers the plan, and the files stay out of Git', () => {
    const plan = planAdoption({
      homeId: 'home-1',
      agents: [{ id: 'agent-app', name: 'App', cwd: layout.mini.app }],
      referencesFor: () => [],
    });
    const result = applyAdoption(plan);
    expect(result).toEqual({ written: [layout.mini.app], registered: [layout.mini.app], skipped: [] });
    expect(readSetupFile(layout.mini.app).state).toBe('ok');
    expect(git(layout.mini.app, 'status', '--porcelain')).toBe('');
    const registry = JSON.parse(fs.readFileSync(path.join(home.configDir, 'setups.json'), 'utf8'));
    expect(registry.locations.map((l: { dir: string }) => l.dir)).toEqual([layout.mini.app]);
  });

  it('never replaces a file that appeared after the plan', () => {
    const plan = planAdoption({ homeId: 'home-1', agents: [{ id: 'a', name: 'A', cwd: layout.mini.app }], referencesFor: () => [] });
    fs.writeFileSync(path.join(layout.mini.app, SETUP_FILE), '{"mine": true}');
    expect(() => applyAdoption(plan)).toThrow(SetupFileConflictError);
    expect(fs.readFileSync(path.join(layout.mini.app, SETUP_FILE), 'utf8')).toBe('{"mine": true}');
  });
});
