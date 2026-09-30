import type { SkillLocationView, SkillSummary } from '@/lib/api/skills';

/**
 * How a skill's place reads in the UI. A skill lives in one of three places,
 * and where it lives is who uses it (docs/skills.md).
 */

/** Home-relative display of an absolute path, the way a shell prompt shows it. */
export function displayPath(path: string): string {
  const home = path.match(/^\/(?:Users|home)\/[^/]+/)?.[0];
  return home ? `~${path.slice(home.length)}` : path;
}

/** Short name of the place: "Ri", "Global", or the project's name. */
export function locationLabel(location: SkillLocationView): string {
  switch (location.kind) {
    case 'ri':
      return 'Ri';
    case 'global':
      return 'Global';
    case 'project':
      return location.projectName;
  }
}

/** One line on where a skill lives and who uses it. */
export function locationSentence(skill: Pick<SkillSummary, 'location' | 'linkedFrom'>): string {
  if (skill.linkedFrom) return `Linked in from ${displayPath(skill.linkedFrom)}. Edit it where it lives.`;
  switch (skill.location.kind) {
    case 'ri':
      return 'A Ri skill. Every chat Ri runs uses it.';
    case 'global':
      return 'A global skill. Every agent on this computer uses it, in Ri and outside it.';
    case 'project':
      return `In ${skill.location.projectName}'s repo. Agents working there use it, and your team gets it once it's committed.`;
  }
}

/** Group headings on the Plugins page. */
export const LOCATION_GROUPS = {
  ri: { title: 'Ri', detail: 'Every chat Ri runs uses these.' },
  global: { title: 'Global', detail: 'Every agent on this computer uses these, in Ri and outside it, like Claude Code in a terminal.' },
} as const;
