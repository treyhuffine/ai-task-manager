/**
 * The desktop's team journeys (docs/homes-spec.md §3.1, P6.2), in Electron
 * main with its dependencies passed in, so the order and the recovery can be
 * tested without Electron:
 *
 * - Join with an invitation (or sign in with a sign-in link): save the team
 *   connection, open the team in its own window. The personal installation
 *   is untouched, and a team-only desktop keeps no personal database.
 * - Create a team hosted here: persist the creation first, make the team in
 *   its own root through the trusted helper (retry-safe by the creation id),
 *   start its own service, save it, open it. An interrupted creation resumes
 *   the same team. One that never made its team can be cancelled, leaving
 *   the personal Ri as it was.
 * - Open a saved team: start its service first when this computer hosts it.
 *   One that can't be opened (its host asleep, its service not starting)
 *   says why on the welcome until a team opens. A joined team that signed
 *   this computer out (the member was removed, or signed it out elsewhere)
 *   is no longer listed, and the welcome says how to get back in.
 */

import path from 'node:path';
import type { HostedTeam, JoinedTeam } from './team-setup';
import {
  beginCreation,
  cancelCreation,
  defaultTeamRoot,
  finishCreation,
  forgetTeam,
  lastOpenedTeam,
  markOpened,
  readTeams,
  saveTeam,
  teamView,
  type SavedTeam,
} from './teams';

export interface TeamFlowDeps {
  teamsPath: string;
  stateDir: string;
  /** Run the trusted setup helper, with a team's own root when `root` is given. */
  setup: <T>(request: Record<string, unknown>, options?: { root?: string; timeoutMs?: number }) => Promise<T>;
  windows: { open(team: SavedTeam, local?: { certificate: string }): Promise<void> };
}

export type CreateTeamInput = { teamName: string; ownerName: string; root?: string; port?: number } | { resume: true };

export function teamFlow(deps: TeamFlowDeps) {
  let issue: { id: string; message: string; forgotten: boolean } | null = null;

  async function startHosted(team: SavedTeam): Promise<{ team: SavedTeam; certificate: string }> {
    const started = await deps.setup<{ origin: string; certificate: string }>({ action: 'start-team' }, { root: team.hosted!.root, timeoutMs: 300_000 });
    const current = started.origin === team.origin ? team : saveTeam(deps.teamsPath, { ...team, origin: started.origin });
    return { team: current, certificate: started.certificate };
  }

  async function open(team: SavedTeam) {
    try {
      if (team.hosted) {
        const { team: running, certificate } = await startHosted(team);
        await deps.windows.open(running, { certificate });
      } else {
        await deps.windows.open(team);
      }
    } catch (error) {
      const signedOut = !team.hosted && (error as { code?: string }).code === 'signed_out';
      if (signedOut) forgetTeam(deps.teamsPath, team.id);
      issue = { id: team.id, message: error instanceof Error ? error.message : `Couldn't open ${team.name}. Try again.`, forgotten: signedOut };
      throw error;
    }
    issue = null;
    markOpened(deps.teamsPath, team.id);
  }

  return {
    /** What the setup page shows: never a team's key. */
    status() {
      const { teams, pending } = readTeams(deps.teamsPath);
      return {
        teams: teams.map(teamView),
        pendingTeam: pending ? { teamName: pending.teamName } : null,
        suggestedName: lastOpenedTeam(deps.teamsPath)?.memberName ?? null,
        teamIssue: issue && (issue.forgotten || teams.some((t) => t.id === issue!.id)) ? { id: issue.id, message: issue.message } : null,
      };
    },

    async join(link: string, name: string | undefined) {
      const joined = await deps.setup<JoinedTeam>({ action: 'join-team', link, ...(name !== undefined ? { name } : {}) });
      const existing = readTeams(deps.teamsPath).teams.find((team) => team.id === joined.team.id);
      const saved = saveTeam(deps.teamsPath, {
        id: joined.team.id,
        name: joined.team.name,
        origin: joined.origin,
        memberId: joined.member.id,
        memberName: joined.member.name,
        role: joined.member.role,
        token: joined.token,
        hosted: existing?.hosted ?? null,
      });
      await open(saved);
      return teamView(saved);
    },

    async create(input: CreateTeamInput) {
      let pending = readTeams(deps.teamsPath).pending;
      if ('resume' in input) {
        if (!pending) throw new Error('There’s no team creation to finish.');
      } else {
        const teamName = input.teamName.trim();
        const ownerName = input.ownerName.trim();
        if (!teamName) throw new Error('Enter a team name.');
        if (!ownerName) throw new Error('Enter your name.');
        if (pending && pending.teamName !== teamName) {
          throw new Error(`Creating ${pending.teamName} hasn’t finished. Finish it or cancel it first.`);
        }
        const root = input.root ? path.resolve(input.root) : defaultTeamRoot(deps.stateDir, teamName);
        pending = beginCreation(deps.teamsPath, { teamName, ownerName, root, port: input.port ?? null });
      }
      const made = await deps.setup<Omit<HostedTeam, 'origin'>>(
        { action: 'create-team', creationId: pending.creationId, teamName: pending.teamName, ownerName: pending.ownerName, ...(pending.port ? { port: pending.port } : {}) },
        { root: pending.root, timeoutMs: 120_000 },
      );
      const saved = saveTeam(deps.teamsPath, {
        id: made.team.id,
        name: made.team.name,
        // Learned when its service starts, just below.
        origin: '',
        memberId: made.member.id,
        memberName: made.member.name,
        role: made.member.role,
        token: made.token,
        hosted: { root: pending.root },
      });
      // The team exists from here: a failure to start it leaves it saved,
      // to open again, never made twice.
      finishCreation(deps.teamsPath, pending.creationId);
      await open(saved);
      return teamView(readTeams(deps.teamsPath).teams.find((t) => t.id === saved.id) ?? saved);
    },

    cancel() {
      cancelCreation(deps.teamsPath);
    },

    async open(id: string) {
      const team = readTeams(deps.teamsPath).teams.find((t) => t.id === id);
      if (!team) throw new Error('That team isn’t saved on this computer.');
      await open(team);
    },

    /** The team a desktop with no personal Ri opens on launch, if it has one. */
    lastOpened(): SavedTeam | null {
      return lastOpenedTeam(deps.teamsPath);
    },
  };
}
