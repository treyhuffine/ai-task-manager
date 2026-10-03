import type { SkillLocationView } from '@/lib/api/skills';

/**
 * How a skill's place reads in the UI. A skill is a draft until it's
 * installed in one of three places, and where it's installed is who uses it
 * (docs/skills.md).
 */

/** Home-relative display of an absolute path, the way a shell prompt shows it. */
export function displayPath(path: string): string {
  const home = path.match(/^\/(?:Users|home)\/[^/]+/)?.[0];
  return home ? `~${path.slice(home.length)}` : path;
}

/** Short name of the place: "Draft", "Ri", "Global", or the project's name. */
export function locationLabel(location: SkillLocationView): string {
  switch (location.kind) {
    case 'draft':
      return 'Draft';
    case 'ri':
      return 'Ri';
    case 'global':
      return 'Global';
    case 'project':
      return location.projectName;
  }
}

/** Who uses a skill in each place, one line each. */
export const WHO_USES = {
  draft: 'No agent uses it until it’s installed.',
  ri: 'Every chat Ri runs uses it.',
  global: 'Every agent on this computer, in Ri and outside it.',
  project: 'Agents working in the repo, and your team once it’s committed.',
} as const;

/** Group headings on the Plugins page. */
export const LOCATION_GROUPS = {
  draft: { title: 'Drafts', detail: 'Written but not installed. No agent uses these until you install them.' },
  ri: { title: 'Ri', detail: 'Every chat Ri runs uses these.' },
  global: { title: 'Global', detail: 'Every agent on this computer uses these, in Ri and outside it, like Claude Code in a terminal.' },
} as const;
