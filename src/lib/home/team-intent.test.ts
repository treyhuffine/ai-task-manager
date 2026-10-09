/**
 * The team mark (src/lib/home/team-intent.ts): written only into a fresh
 * root, retry-safe by creation id, and read strictly, so a root is a team
 * from its first start or not at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { readTeamIntent, teamIntentPath, TeamIntentError, writeTeamIntent } from './team-intent';

let home: TestHome;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-team-intent-', openDb: false });
});
afterEach(async () => {
  await home.cleanup();
});

describe('the team mark', () => {
  it('marks a fresh root, and the same creation finds the same mark again', () => {
    const first = writeTeamIntent({ creationId: 'create-0001', name: '  Acme   Labs ' });
    expect(first).toMatchObject({ kind: 'team', creationId: 'create-0001', name: 'Acme Labs' });
    expect(fs.statSync(teamIntentPath()).mode & 0o777).toBe(0o600);
    expect(writeTeamIntent({ creationId: 'create-0001', name: 'Other' })).toEqual(first);
    expect(readTeamIntent()).toEqual(first);
  });

  it('refuses a second creation in the same folder', () => {
    writeTeamIntent({ creationId: 'create-0001', name: 'Acme' });
    expect(() => writeTeamIntent({ creationId: 'create-0002', name: 'Acme' })).toThrow(TeamIntentError);
  });

  it('names a team that was given no name', () => {
    expect(writeTeamIntent({ creationId: 'create-0001' }).name).toBe('Team');
  });

  it('never turns a personal home, a connected device or a chosen personal Ri into a team', () => {
    fs.writeFileSync(home.dbPath, '');
    expect(() => writeTeamIntent({ creationId: 'create-0001' })).toThrow(/empty folder/);
    fs.rmSync(home.dbPath);

    fs.writeFileSync(path.join(home.configDir, 'connection.json'), '{}');
    expect(() => writeTeamIntent({ creationId: 'create-0001' })).toThrow(/empty folder/);
    fs.rmSync(path.join(home.configDir, 'connection.json'));

    fs.writeFileSync(path.join(home.configDir, 'desktop-role.json'), JSON.stringify({ version: 1, role: 'home' }), { mode: 0o600 });
    expect(() => writeTeamIntent({ creationId: 'create-0001' })).toThrow(/personal Ri/);
    expect(readTeamIntent()).toBeNull();
  });

  it('refuses a mark it cannot trust rather than starting a personal home', () => {
    fs.writeFileSync(teamIntentPath(), JSON.stringify({ version: 1, kind: 'team', creationId: 'create-0001', name: 'Acme' }), { mode: 0o644 });
    expect(() => readTeamIntent()).toThrow(/private file/);
    fs.chmodSync(teamIntentPath(), 0o600);
    expect(readTeamIntent()?.name).toBe('Acme');
    fs.writeFileSync(teamIntentPath(), JSON.stringify({ version: 2, kind: 'team', creationId: 'create-0001' }), { mode: 0o600 });
    expect(() => readTeamIntent()).toThrow(/another version/);
  });

  it('refuses a creation id that could not have come from a creation flow', () => {
    expect(() => writeTeamIntent({ creationId: 'x' })).toThrow(TeamIntentError);
  });
});
