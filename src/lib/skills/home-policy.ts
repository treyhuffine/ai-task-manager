import { hasTeamCapability } from '@/lib/team/capabilities';
import * as q from '@/lib/db/queries';
import { getRequestKey } from '@/lib/auth/request-key';
import { authorizeTeamExecution } from '@/lib/home/execution-authority';
import type { SkillView, SkillsOverview } from './manage';
import { parseSkillRef } from './locations';

/** A shared Home owns its library, never the host's global/project channels. */
export function homeSkillLibraryOnly() { return q.getHome()?.kind === 'team'; }

export function authorizeSkillOperation(headers: Headers, write = false, ref?: string) {
  if (!homeSkillLibraryOnly()) return null;
  const { member } = authorizeTeamExecution(getRequestKey(headers), { operation: write ? 'configure' : 'readCatalog' });
  const location = ref ? parseSkillRef(ref)?.location.kind : null;
  if (ref && (!location || !['draft', 'ri'].includes(location) || (location === 'draft' && !hasTeamCapability(member, 'configureAgents')))) throw new q.TeamError('not_found', 'That shared skill is unavailable.');
  return member;
}

export function skillOverviewForHome(overview: SkillsOverview, member: ReturnType<typeof authorizeSkillOperation>): SkillsOverview {
  if (!member) return overview;
  return { ...overview, skills: overview.skills.filter(skill => skill.location.kind === 'ri' || (hasTeamCapability(member, 'configureAgents') && skill.location.kind === 'draft')), projects: [], canWriteGlobal: false };
}
export function skillViewForHome(skill: SkillView, member: ReturnType<typeof authorizeSkillOperation>): SkillView {
  if (!member) return skill;
  return { ...skill, dir: `<team-home>/${skill.location.kind === 'draft' ? 'skill-drafts' : 'skills'}/${skill.name}`, linkedFrom: null, editable: hasTeamCapability(member, 'configureAgents'), canWriteGlobal: false };
}
