import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beginCreation, cancelCreation, defaultTeamRoot, finishCreation, forgetTeam, lastOpenedTeam, markOpened, readTeams, saveTeam, teamsFile, teamView } from './teams';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-desktop-teams-'));
  file = teamsFile(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const acme = { id: 'team-1', name: 'Acme', origin: 'https://acme.example', memberId: 'm1', memberName: 'Maya', role: 'member' as const, token: 'ri_live_secret', hosted: null };

describe('the desktop team store', () => {
  it('starts empty, saves privately, and replaces a team rather than duplicating it', () => {
    expect(readTeams(file)).toEqual({ version: 1, teams: [], pending: null });
    saveTeam(file, acme);
    saveTeam(file, { ...acme, name: 'Acme Labs', token: 'ri_live_newer' });
    const { teams } = readTeams(file);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ name: 'Acme Labs', token: 'ri_live_newer' });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('opens the team opened last, and forgets one on request', () => {
    saveTeam(file, acme);
    saveTeam(file, { ...acme, id: 'team-2', name: 'Family' });
    markOpened(file, 'team-1');
    expect(lastOpenedTeam(file)?.name).toBe('Acme');
    forgetTeam(file, 'team-1');
    expect(lastOpenedTeam(file)?.name).toBe('Family');
  });

  it('resumes the same creation after an interruption, and a new one gets a new id', () => {
    const first = beginCreation(file, { teamName: 'Acme', ownerName: 'Trey', root: '/tmp/acme', port: null });
    expect(beginCreation(file, { teamName: 'Other', ownerName: 'Trey', root: '/tmp/other', port: null })).toEqual(first);
    finishCreation(file, 'not-this-one');
    expect(readTeams(file).pending).toEqual(first);
    finishCreation(file, first.creationId);
    expect(readTeams(file).pending).toBeNull();
    const second = beginCreation(file, { teamName: 'Family', ownerName: 'Trey', root: '/tmp/family', port: 4300 });
    expect(second.creationId).not.toBe(first.creationId);
    cancelCreation(file);
    expect(readTeams(file).pending).toBeNull();
  });

  it('gives each hosted team its own folder', () => {
    const one = defaultTeamRoot(dir, 'Acme Labs!');
    expect(path.basename(one)).toBe('acme-labs');
    fs.mkdirSync(one, { recursive: true });
    expect(path.basename(defaultTeamRoot(dir, 'Acme Labs'))).toBe('acme-labs-2');
  });

  it("never shows a team's key to the setup page", () => {
    expect(teamView({ ...acme, addedAt: 'now', openedAt: null })).not.toHaveProperty('token');
  });

  it('refuses a file from another version rather than overwriting it', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 2, teams: [] }));
    expect(() => readTeams(file)).toThrow(/version/);
  });
});
