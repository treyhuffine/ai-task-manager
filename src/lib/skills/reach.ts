/**
 * Where a library skill reaches. One setting, four answers, widest first:
 *
 *   everywhere  every agent in Ri, and every harness outside Ri on this
 *               computer (linked into ~/.claude/skills and ~/.agents/skills)
 *   all         every agent in Ri. The standard case: no database row.
 *   agents      only the listed agents, in their main chats and executions
 *   off         no chat. Where a new skill starts, so nothing picks up a
 *               half-written one.
 *
 * It's one setting rather than an "in Ri" choice plus an "outside Ri" toggle
 * because the two can't be combined freely: a skill linked outside Ri is
 * read natively by every Claude and Codex session, Ri's included, so
 * "only these agents" plus "outside Ri" would be a promise Ri can't keep.
 *
 * The database holds the Ri side (schema.ts `skill_scopes`), the links hold
 * the outside side, and ./exclusions.ts turns the rows into what one chat
 * must not get. See docs/skills.md.
 */

import type { SkillScopeRecord } from '@/db/types';
import { clearSkillScope, getSkillScope, getWorkspace, listSkillScopes, setSkillScope } from '@/lib/db/queries';
import { SkillError, listLibrarySkills, requireSkill } from './library';
import { canReachOutside, installOutside, outsideLinkState, outsideLinkStates, removeOutside, removeSessionLinks } from './outside';

export type SkillReach =
  | { mode: 'everywhere' }
  | { mode: 'all' }
  | { mode: 'agents'; workspaceIds: string[] }
  | { mode: 'off' };

export type SkillReachMode = SkillReach['mode'];

export const REACH_MODES: readonly SkillReachMode[] = ['everywhere', 'all', 'agents', 'off'];

/** How wide each mode is, for "does this change widen the skill's reach?". */
const WIDTH: Record<SkillReachMode, number> = { off: 0, agents: 1, all: 2, everywhere: 3 };

export function reachFrom(scope: Pick<SkillScopeRecord, 'workspaceIds'> | null, linkedOutside: boolean): SkillReach {
  if (scope) {
    return scope.workspaceIds.length === 0 ? { mode: 'off' } : { mode: 'agents', workspaceIds: [...scope.workspaceIds] };
  }
  return linkedOutside ? { mode: 'everywhere' } : { mode: 'all' };
}

/**
 * Whether `next` lets the skill reach anything `current` didn't. Narrowing is
 * always allowed. Widening is the user's call, so an agent over MCP can't
 * turn on a skill it just wrote.
 */
export function widens(current: SkillReach, next: SkillReach): boolean {
  if (WIDTH[next.mode] > WIDTH[current.mode]) return true;
  if (next.mode === 'agents' && current.mode === 'agents') {
    return next.workspaceIds.some((id) => !current.workspaceIds.includes(id));
  }
  return false;
}

export async function getSkillReach(name: string): Promise<SkillReach> {
  return reachFrom(getSkillScope(name), (await outsideLinkState(name)).installed);
}

/** Reach for every library skill, from one read of the table and the outside folders. */
export async function listSkillReaches(): Promise<Map<string, SkillReach>> {
  const names = listLibrarySkills().map((skill) => skill.name);
  const scopes = new Map(listSkillScopes().map((row) => [row.name, row]));
  const links = await outsideLinkStates(names);
  return new Map(names.map((name) => [name, reachFrom(scopes.get(name) ?? null, links.get(name)?.installed ?? false)]));
}

/**
 * Change where a skill reaches. Anything wider than off needs a skill that
 * passes its checks, since an agent would load it. Outside links go on
 * first, so a conflict outside Ri fails the change before anything moves.
 */
export async function setSkillReach(name: string, reach: SkillReach): Promise<SkillReach> {
  const skill = requireSkill(name);
  if (reach.mode !== 'off') {
    const blocking = skill.problems.find((problem) => problem.level === 'error');
    if (blocking) throw new SkillError('invalid', `Fix this first: ${blocking.message}`);
  }
  if (reach.mode === 'agents') {
    const ids = [...new Set(reach.workspaceIds)];
    if (ids.length === 0) throw new SkillError('invalid', 'Pick at least one agent, or turn the skill off.');
    const unknown = ids.find((id) => !getWorkspace(id));
    if (unknown) throw new SkillError('invalid', `There's no agent with id ${unknown}.`);
    reach = { mode: 'agents', workspaceIds: ids };
  }

  switch (reach.mode) {
    case 'everywhere':
      if (!canReachOutside()) throw new SkillError('invalid', 'The desktop app keeps skills inside Ri.');
      await installOutside(name);
      clearSkillScope(name);
      break;
    case 'all':
      clearSkillScope(name);
      await removeOutside(name);
      break;
    case 'agents':
      setSkillScope(name, reach.workspaceIds);
      await removeOutside(name);
      break;
    case 'off':
      setSkillScope(name, []);
      await removeOutside(name);
      break;
  }
  // A narrower reach only holds once links Codex left in chat folders are gone.
  if (reach.mode === 'agents' || reach.mode === 'off') await removeSessionLinks([name]);
  return getSkillReach(name);
}
