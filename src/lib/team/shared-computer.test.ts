import { APP_SHORT_ID } from '@/constants/app';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { homeRegistryDir, registeredPersonalRoots, registerHomeRoot } from '@/lib/home/root-registry';
import { teamSharesPersonalComputer } from './shared-computer';

const temporary: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-cohost-check-'));
  temporary.push(dir);
  return dir;
}

it('retains the desktop creation fact without requiring the personal Home to be running', () => {
  expect(teamSharesPersonalComputer({ recorded: true, roots: [] })).toBe(true);
});

it('detects an existing personal Home using file metadata without opening its database', () => {
  const personal = root();
  fs.writeFileSync(path.join(personal, 'data.db'), 'This is deliberately not a valid SQLite file');
  expect(teamSharesPersonalComputer({ recorded: false, roots: [personal], currentRoot: root() })).toBe(true);
  expect(fs.readFileSync(path.join(personal, 'data.db'), 'utf8')).toBe('This is deliberately not a valid SQLite file');
});

it('does not mistake this Team Home, another team or an empty folder for a personal Ri', () => {
  const team = root(), empty = root();
  fs.mkdirSync(path.join(team, '.config'));
  fs.writeFileSync(path.join(team, '.config', 'team.json'), '{}');
  fs.writeFileSync(path.join(team, 'data.db'), 'team');
  expect(teamSharesPersonalComputer({ recorded: false, roots: [team, empty], currentRoot: team })).toBe(false);
});

it('finds a custom personal Home registered after a Team was created, without reading SQLite', () => {
  const registry = root(), team = root(), personal = root();
  vi.stubEnv('RI_HOME_REGISTRY_DIR', registry);
  expect(teamSharesPersonalComputer({ roots: [], currentRoot: team, recorded: false })).toBe(false);
  fs.writeFileSync(path.join(personal, 'data.db'), 'not SQLite, never opened');
  registerHomeRoot('personal', personal);
  expect(teamSharesPersonalComputer({ currentRoot: team, recorded: false })).toBe(true);
  expect(fs.readFileSync(path.join(personal, 'data.db'), 'utf8')).toBe('not SQLite, never opened');
});

it('uses the ordinary OS registry path outside Vitest mode, with an isolated OS home', () => {
  const osHome = root(), personal = root();
  vi.spyOn(os, 'homedir').mockReturnValue(osHome);
  vi.stubEnv('VITEST', ''); vi.stubEnv('RI_HOME_REGISTRY_DIR', undefined);
  expect(homeRegistryDir()).toBe(path.join(osHome, '.config', APP_SHORT_ID, 'home-roots'));
  fs.writeFileSync(path.join(personal, 'data.db'), 'metadata only');
  registerHomeRoot('personal', personal);
  expect(registeredPersonalRoots()).toEqual([fs.realpathSync(personal)]);
});
