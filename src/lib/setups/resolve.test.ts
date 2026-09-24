import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTwoComputerLayout, type TwoComputerLayout } from '@/test/fixtures/git';
import { SETUP_FILE, writeSetupFile, type SetupFile } from './local-file';
import { resolveSetups } from './resolve';

/**
 * The spec's example (§4.1): one Ri agent, set up on a MacBook at
 * ~/dynamism/ri with agentex beside it, and on a Mac Mini at
 * ~/ai-task-manager with agentex under ~/code. Each computer's file holds
 * only its own paths, and both resolve to the right folders.
 */

const HOME = 'home-1';
const RI = 'agent-ri';
const EXPECTED = { [RI]: [{ alias: 'agentex' }] };

let layout: TwoComputerLayout;

beforeEach(() => {
  layout = createTwoComputerLayout();
});

afterEach(() => {
  layout.cleanup();
});

const fileFor = (agentex: SetupFile['agents'][string]['references'][string]): SetupFile => ({
  version: 1,
  homeId: HOME,
  agents: { [RI]: { references: { agentex } } },
});

describe('the two layouts of one agent', () => {
  it('resolves each computer to its own folders from its own file', () => {
    writeSetupFile(layout.macbook.app, fileFor(layout.macbook.agentexRelative), null);
    writeSetupFile(layout.mini.app, fileFor(layout.mini.agentexRelative), null);

    const [macbook] = resolveSetups({ homeId: HOME, registered: [layout.macbook.app], expected: EXPECTED });
    const [mini] = resolveSetups({ homeId: HOME, registered: [layout.mini.app], expected: EXPECTED });

    expect(macbook).toMatchObject({ agentId: RI, status: 'ready', sourcePath: layout.macbook.app });
    expect(macbook!.references[0]).toMatchObject({ form: 'path', value: '../agentex', path: layout.macbook.agentex, exists: true });
    expect(mini).toMatchObject({ agentId: RI, status: 'ready', sourcePath: layout.mini.app });
    expect(mini!.references[0]).toMatchObject({ value: '../code/agentex', path: layout.mini.agentex, exists: true });
  });

  it('resolves from the source folder, including in a monorepo subfolder', () => {
    const mono = createTwoComputerLayout({ monorepoSubdir: 'apps/web' });
    try {
      writeSetupFile(mono.mini.app, fileFor(mono.mini.agentexRelative), null);
      const [report] = resolveSetups({ homeId: HOME, registered: [mono.mini.app], expected: EXPECTED });
      expect(report).toMatchObject({ status: 'ready', sourcePath: mono.mini.app });
      expect(report!.references[0]!.path).toBe(mono.mini.agentex);
    } finally {
      mono.cleanup();
    }
  });

  it("resolves a reference to another agent to that agent's folder on the same computer", () => {
    writeSetupFile(layout.mini.app, fileFor({ agentId: 'agent-agentex' }), null);
    writeSetupFile(layout.mini.agentex, { version: 1, homeId: HOME, agents: { 'agent-agentex': { references: {} } } }, null);
    const reports = resolveSetups({ homeId: HOME, registered: [layout.mini.app, layout.mini.agentex], expected: EXPECTED });
    const ri = reports.find((r) => r.agentId === RI)!;
    expect(ri.status).toBe('ready');
    expect(ri.references[0]).toMatchObject({ form: 'agent', path: layout.mini.agentex });
  });
});

describe('references that block', () => {
  it('blocks an unset reference until it is chosen or left out', () => {
    writeSetupFile(layout.mini.app, { version: 1, homeId: HOME, agents: { [RI]: { references: {} } } }, null);
    const [unset] = resolveSetups({ homeId: HOME, registered: [layout.mini.app], expected: EXPECTED });
    expect(unset).toMatchObject({ status: 'missing_reference', problem: expect.stringMatching(/isn't set up on this computer/) });
  });

  it('accepts a reference left out on purpose', () => {
    writeSetupFile(layout.mini.app, fileFor(null), null);
    const [omitted] = resolveSetups({ homeId: HOME, registered: [layout.mini.app], expected: EXPECTED });
    expect(omitted).toMatchObject({ status: 'ready' });
    expect(omitted!.references[0]).toMatchObject({ form: 'omitted', path: null });
  });

  it('blocks a path that is gone, and an agent with no folder here', () => {
    writeSetupFile(layout.mini.app, fileFor('../nowhere'), null);
    expect(resolveSetups({ homeId: HOME, registered: [layout.mini.app], expected: EXPECTED })[0]).toMatchObject({
      status: 'missing_reference',
      problem: expect.stringMatching(/doesn't exist/),
    });
    fs.rmSync(path.join(layout.mini.app, SETUP_FILE));
    writeSetupFile(layout.mini.app, fileFor({ agentId: 'agent-elsewhere' }), null);
    expect(resolveSetups({ homeId: HOME, registered: [layout.mini.app], expected: EXPECTED })[0]).toMatchObject({
      status: 'missing_reference',
      problem: expect.stringMatching(/no folder on this computer/),
    });
  });
});

describe('setup files that are wrong or gone', () => {
  it('ignores a copied file that was never registered here', () => {
    writeSetupFile(layout.mini.app, fileFor(layout.mini.agentexRelative), null);
    expect(resolveSetups({ homeId: HOME, registered: [], expected: EXPECTED })).toEqual([]);
  });

  it('reports a malformed file against the agent last seen there', () => {
    fs.writeFileSync(path.join(layout.mini.app, SETUP_FILE), '{"version": 1,');
    const [report] = resolveSetups({
      homeId: HOME,
      registered: [layout.mini.app],
      expected: EXPECTED,
      lastSeen: { [RI]: layout.mini.app },
    });
    expect(report).toMatchObject({ agentId: RI, status: 'invalid_config', problem: expect.stringMatching(/not valid JSON/) });
  });

  it('reports a file from another home as wrong_home', () => {
    writeSetupFile(layout.mini.app, { ...fileFor(null), homeId: 'someone-else' }, null);
    const [report] = resolveSetups({
      homeId: HOME,
      registered: [layout.mini.app],
      expected: EXPECTED,
      lastSeen: { [RI]: layout.mini.app },
    });
    expect(report).toMatchObject({ status: 'wrong_home' });
  });

  it('reports a deleted file, as after git clean -fdx, so it can be restored', () => {
    writeSetupFile(layout.mini.app, fileFor(layout.mini.agentexRelative), null);
    fs.rmSync(path.join(layout.mini.app, SETUP_FILE));
    const [report] = resolveSetups({
      homeId: HOME,
      registered: [layout.mini.app],
      expected: EXPECTED,
      lastSeen: { [RI]: layout.mini.app },
    });
    expect(report).toMatchObject({ status: 'missing_file', problem: expect.stringMatching(/Restore it/) });
  });

  it('reports a renamed folder as missing, then ready once relinked to the new place', () => {
    writeSetupFile(layout.mini.app, fileFor(layout.mini.agentexRelative), null);
    const renamed = path.join(path.dirname(layout.mini.app), 'ri');
    fs.renameSync(layout.mini.app, renamed);

    const [gone] = resolveSetups({
      homeId: HOME,
      registered: [layout.mini.app],
      expected: EXPECTED,
      lastSeen: { [RI]: layout.mini.app },
    });
    expect(gone).toMatchObject({ status: 'missing_folder', problem: expect.stringMatching(/relink/) });

    // The file moved with the folder, so relinking is only a new registration.
    const agentexFromNew = path.relative(renamed, layout.mini.agentex);
    expect(agentexFromNew).toBe(layout.mini.agentexRelative);
    const [back] = resolveSetups({ homeId: HOME, registered: [renamed], expected: EXPECTED, lastSeen: { [RI]: layout.mini.app } });
    expect(back).toMatchObject({ status: 'ready', sourcePath: renamed });
  });

  it('flags two folders claiming one agent', () => {
    writeSetupFile(layout.mini.app, fileFor(null), null);
    writeSetupFile(layout.mini.agentex, fileFor(null), null);
    const [report] = resolveSetups({ homeId: HOME, registered: [layout.mini.app, layout.mini.agentex], expected: EXPECTED });
    expect(report).toMatchObject({ status: 'duplicate', problem: expect.stringMatching(/Keep one/) });
  });
});
