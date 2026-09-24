import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { refusalFor } from './role-guard';

const keys = ['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR'] as const;
let root: string;
let saved: [string, string | undefined][];

beforeEach(() => {
  saved = keys.map((k) => [k, process.env[k]]);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-role-guard-'));
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

describe('refusalFor', () => {
  it('lets commands that keep no data run anywhere', () => {
    for (const name of ['start', 'status', 'doctor', 'stop', 'voice', 'tls']) expect(refusalFor(name)).toBeNull();
  });

  it('refuses data commands on a fresh folder instead of making a new home', () => {
    expect(refusalFor('agent')).toMatch(/isn't set up on this computer yet/);
    expect(refusalFor('snapshot')).toMatch(/isn't set up/);
    expect(fs.existsSync(path.join(root, 'data.db'))).toBe(false);
  });

  it('names the home on a connected computer', () => {
    fs.mkdirSync(path.join(root, '.config'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.config', 'connection.json'),
      JSON.stringify({ homeId: 'h', homeName: 'My Ri', homeUrl: 'https://ri-trey.beamd.run', credential: 'k' }),
    );
    expect(refusalFor('snapshot')).toMatch(/connected to My Ri at https:\/\/ri-trey\.beamd\.run/);
  });

  it('runs everything on a home', () => {
    fs.writeFileSync(path.join(root, 'data.db'), '');
    expect(refusalFor('agent')).toBeNull();
    expect(refusalFor('snapshot')).toBeNull();
  });
});
