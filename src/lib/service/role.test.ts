/**
 * What the background service on a computer is for, decided from its files
 * before anything opens a database (docs/desktop.md handoff item 1).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { describeServiceRole, resolveServiceRole, servesHome } from './role';

const keys = ['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR'] as const;
let root: string;
let saved: Array<[string, string | undefined]>;
const config = () => path.join(root, '.config');
const write = (file: string, body: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body));
};
const connection = { version: 1, homeId: 'home-1', homeName: 'My Ri', homeUrl: 'https://ri-trey.beamd.run', homeHostName: 'Mac Mini', credential: 'k', connectedAt: 'x' };

beforeEach(() => {
  saved = keys.map((k) => [k, process.env[k]]);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-service-role-'));
  process.env.RI_ROOT = root;
  for (const k of keys.slice(1)) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

it('runs a home where there is one, and on a first run', () => {
  expect(resolveServiceRole()).toEqual({ role: 'first-run' });
  fs.writeFileSync(path.join(root, 'data.db'), '');
  const role = resolveServiceRole();
  expect(role).toEqual({ role: 'home' });
  expect(servesHome(role)).toBe(true);
  expect(describeServiceRole(role)).toBeNull();
});

it("runs the worker where the computer is enrolled with the home it's connected to, and nothing where it isn't", () => {
  write(path.join(config(), 'connection.json'), connection);
  expect(resolveServiceRole()).toEqual({ role: 'viewer', home: { url: 'https://ri-trey.beamd.run', name: 'My Ri' } });
  write(path.join(config(), 'worker.json'), { version: 1, homeId: 'home-1', computerId: 'c', computerName: 'MacBook', workerKey: 'w', enrolledAt: 'x' });
  const role = resolveServiceRole();
  expect(role).toEqual({ role: 'worker', home: { url: 'https://ri-trey.beamd.run', name: 'My Ri' }, computerName: 'MacBook' });
  expect(servesHome(role)).toBe(false);
  expect(describeServiceRole(role)).toMatch(/runs work for My Ri at https:\/\/ri-trey\.beamd\.run/);
  // Enrolled with another home: nothing runs here.
  write(path.join(config(), 'worker.json'), { version: 1, homeId: 'home-2', computerId: 'c', computerName: 'MacBook', workerKey: 'w', enrolledAt: 'x' });
  expect(resolveServiceRole().role).toBe('viewer');
});

it('never starts a home where one was retired, or where a database sits beside a connection', () => {
  write(path.join(root, '.retired', 't', 'retired.json'), { version: 1, homeId: null, homeName: 'My Ri', host: null, retiredAt: '2026-09-29T00:00:00.000Z', successor: 'the Mac Mini', counts: {} });
  const retired = resolveServiceRole();
  expect(retired.role).toBe('retired');
  expect(servesHome(retired)).toBe(false);
  expect(describeServiceRole(retired)).toMatch(/was retired on 2026-09-29\. Its work now lives in the Mac Mini\./);
  fs.writeFileSync(path.join(root, 'data.db'), '');
  write(path.join(config(), 'connection.json'), connection);
  expect(resolveServiceRole().role).toBe('conflict');
});
