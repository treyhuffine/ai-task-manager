import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { teamFlow } from './team-flow';
import { readTeams, teamsFile } from './teams';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-desktop-team-flow-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function harness(setup: (request: Record<string, unknown>, options?: { root?: string }) => unknown) {
  const opened: Array<{ name: string; origin: string; local?: { certificate: string } }> = [];
  const calls: Array<{ request: Record<string, unknown>; root?: string }> = [];
  const flow = teamFlow({
    teamsPath: teamsFile(dir),
    stateDir: dir,
    setup: async (request, options) => {
      calls.push({ request, root: options?.root });
      return setup(request, options) as never;
    },
    windows: { open: async (team, local) => { opened.push({ name: team.name, origin: team.origin, local }); } },
  });
  return { flow, opened, calls };
}

const made = { root: '', team: { id: 'team-1', name: 'Acme' }, member: { id: 'owner-1', name: 'Trey', role: 'owner' }, token: 'ri_live_owner', created: true };

describe('desktop team journeys', () => {
  it('keeps the hosted root and certificate handling when signing in to the same team again', async () => {
    const { flow, opened, calls } = harness((request, options) => {
      if (request.action === 'create-team') return { ...made, root: options!.root };
      if (request.action === 'join-team') return { ...made, token: 'ri_live_replacement', origin: 'https://acme.example' };
      return { origin: 'https://localhost:42300', certificate: 'PEM' };
    });
    await flow.create({ teamName: 'Acme', ownerName: 'Trey' });
    const hosted = readTeams(teamsFile(dir)).teams[0].hosted;
    await flow.join('https://acme.example/join#sign-in=rtg_x', undefined);
    expect(readTeams(teamsFile(dir)).teams).toMatchObject([{ hosted, token: 'ri_live_replacement', origin: 'https://localhost:42300' }]);
    expect(calls.map((c) => c.request.action)).toEqual(['create-team', 'start-team', 'join-team', 'start-team']);
    expect(opened.at(-1)?.local).toEqual({ certificate: 'PEM' });
  });
  it('joins a team as a team-only connection and opens it in its own window', async () => {
    const { flow, opened } = harness((request) => {
      expect(request).toEqual({ action: 'join-team', link: 'https://acme.example/join#invite=rtg_x', name: 'Maya' });
      return { team: { id: 'team-1', name: 'Acme' }, origin: 'https://acme.example', member: { id: 'm', name: 'Maya', role: 'member' }, token: 'ri_live_member' };
    });
    expect(await flow.join('https://acme.example/join#invite=rtg_x', 'Maya')).toMatchObject({ name: 'Acme', hosted: false });
    expect(opened).toEqual([{ name: 'Acme', origin: 'https://acme.example', local: undefined }]);
    expect(flow.status()).toMatchObject({ teams: [{ name: 'Acme', memberName: 'Maya' }], suggestedName: 'Maya' });
    expect(JSON.stringify(flow.status())).not.toContain('ri_live_member');
  });

  it('creates a team in its own folder, starts its own service and opens it with the pinned certificate', async () => {
    const { flow, opened, calls } = harness((request, options) => {
      if (request.action === 'create-team') return { ...made, root: options!.root };
      return { origin: 'https://localhost:42300', certificate: 'PEM' };
    });
    await flow.create({ teamName: 'Acme', ownerName: 'Trey' });
    expect(calls.map((c) => c.request.action)).toEqual(['create-team', 'start-team']);
    expect(calls[0].root).toBe(path.join(dir, 'teams', 'acme'));
    expect(calls[1].root).toBe(calls[0].root);
    expect(opened).toEqual([{ name: 'Acme', origin: 'https://localhost:42300', local: { certificate: 'PEM' } }]);
    expect(readTeams(teamsFile(dir))).toMatchObject({ pending: null, teams: [{ id: 'team-1', origin: 'https://localhost:42300', hosted: { root: calls[0].root } }] });
  });

  it('resumes an interrupted creation with the same id and folder, never a second team', async () => {
    let failCreate = true;
    const { flow, calls } = harness((request, options) => {
      if (request.action === 'create-team') {
        if (failCreate) throw new Error('The helper was interrupted.');
        return { ...made, root: options!.root, created: false };
      }
      return { origin: 'https://localhost:42300', certificate: 'PEM' };
    });
    await expect(flow.create({ teamName: 'Acme', ownerName: 'Trey' })).rejects.toThrow('interrupted');
    expect(flow.status().pendingTeam).toEqual({ teamName: 'Acme' });
    // A double click with another name doesn't start a second creation.
    await expect(flow.create({ teamName: 'Other', ownerName: 'Trey' })).rejects.toThrow(/hasn’t finished/);
    failCreate = false;
    await flow.create({ resume: true });
    const creates = calls.filter((c) => c.request.action === 'create-team');
    expect(creates.map((c) => c.request.creationId)).toEqual([creates[0].request.creationId, creates[0].request.creationId]);
    expect(creates[1].root).toBe(creates[0].root);
    expect(readTeams(teamsFile(dir)).teams).toHaveLength(1);
  });

  it("keeps a team that was made even when its service doesn't start, to open again", async () => {
    let start = 0;
    const { flow } = harness((request, options) => {
      if (request.action === 'create-team') return { ...made, root: options!.root };
      if (start++ === 0) throw new Error('The service did not start.');
      return { origin: 'https://localhost:42300', certificate: 'PEM' };
    });
    await expect(flow.create({ teamName: 'Acme', ownerName: 'Trey' })).rejects.toThrow('did not start');
    expect(readTeams(teamsFile(dir))).toMatchObject({ pending: null, teams: [{ id: 'team-1' }] });
    await flow.open('team-1');
    expect(readTeams(teamsFile(dir)).teams[0].origin).toBe('https://localhost:42300');
  });

  it("says why a saved team didn't open, until a team opens", async () => {
    let reachable = false;
    const flow = teamFlow({
      teamsPath: teamsFile(dir),
      stateDir: dir,
      setup: async () => ({ team: { id: 'team-1', name: 'Acme' }, origin: 'https://acme.example', member: { id: 'm', name: 'Maya', role: 'member' }, token: 'ri_live_member' }) as never,
      windows: {
        open: async (team) => {
          if (!reachable) throw new Error(`Couldn't reach ${team.name}. The computer hosting it may be asleep or offline. Try again.`);
        },
      },
    });
    await expect(flow.join('https://acme.example/join#invite=rtg_x', 'Maya')).rejects.toThrow('asleep');
    // The connection is saved even when the team is out of reach right now.
    expect(flow.status()).toMatchObject({ teams: [{ id: 'team-1' }], teamIssue: { id: 'team-1', message: expect.stringContaining("Couldn't reach Acme") } });
    reachable = true;
    await flow.open('team-1');
    expect(flow.status().teamIssue).toBeNull();
  });

  it('stops listing a joined team that signed this computer out, and says how to get back in', async () => {
    const message = 'Acme signed this computer out. To use it again, paste a new invitation or sign-in link in Connect to Ri.';
    let signedOut = false;
    const flow = teamFlow({
      teamsPath: teamsFile(dir),
      stateDir: dir,
      setup: async () => ({ team: { id: 'team-1', name: 'Acme' }, origin: 'https://acme.example', member: { id: 'm', name: 'Maya', role: 'member' }, token: 'ri_live_member' }) as never,
      windows: {
        open: async () => {
          if (signedOut) throw Object.assign(new Error(message), { code: 'signed_out' });
        },
      },
    });
    await flow.join('https://acme.example/join#invite=rtg_x', 'Maya');
    signedOut = true;
    await expect(flow.open('team-1')).rejects.toThrow('signed this computer out');
    expect(flow.status()).toMatchObject({ teams: [], teamIssue: { id: 'team-1', message } });
    // Joining again lists it again, and the notice goes once it opens.
    signedOut = false;
    await flow.join('https://acme.example/join#invite=rtg_y', 'Maya');
    expect(flow.status()).toMatchObject({ teams: [{ id: 'team-1' }], teamIssue: null });
  });

  it("never forgets a team hosted here, whatever its window says", async () => {
    const { flow } = harness((request, options) => {
      if (request.action === 'create-team') return { ...made, root: options!.root };
      return { origin: 'https://localhost:42300', certificate: 'PEM' };
    });
    await flow.create({ teamName: 'Acme', ownerName: 'Trey' });
    const failing = teamFlow({
      teamsPath: teamsFile(dir),
      stateDir: dir,
      setup: async () => ({ origin: 'https://localhost:42300', certificate: 'PEM' }) as never,
      windows: { open: async () => { throw Object.assign(new Error('Acme signed this computer out.'), { code: 'signed_out' }); } },
    });
    await expect(failing.open('team-1')).rejects.toThrow('signed this computer out');
    expect(failing.status()).toMatchObject({ teams: [{ id: 'team-1' }], teamIssue: { id: 'team-1' } });
  });

  it('cancels a creation that never made its team', async () => {
    const { flow } = harness(() => {
      throw new Error('A team needs an empty folder of its own.');
    });
    await expect(flow.create({ teamName: 'Acme', ownerName: 'Trey', root: path.join(dir, 'busy') })).rejects.toThrow('empty folder');
    flow.cancel();
    expect(flow.status()).toEqual({ teams: [], pendingTeam: null, suggestedName: null, teamIssue: null });
  });

  it('asks for the names before doing anything', async () => {
    const { flow, calls } = harness(() => ({}));
    await expect(flow.create({ teamName: ' ', ownerName: 'Trey' })).rejects.toThrow('team name');
    await expect(flow.create({ teamName: 'Acme', ownerName: '' })).rejects.toThrow('your name');
    expect(calls).toEqual([]);
    expect(flow.status().pendingTeam).toBeNull();
  });
});
