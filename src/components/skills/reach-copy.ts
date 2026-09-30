import type { SkillReach } from '@/lib/api/skills';

/**
 * How a skill's reach reads in the UI. Every agent is the standard case, so
 * it gets no badge. Only a deviation is labeled (off, some agents, also
 * outside Ri).
 */

/** The badge for a skill that isn't on for every agent, or null when it is. */
export function reachBadge(reach: SkillReach): string | null {
  switch (reach.mode) {
    case 'off':
      return 'Off';
    case 'agents':
      return reach.workspaceIds.length === 1 ? '1 agent' : `${reach.workspaceIds.length} agents`;
    case 'everywhere':
      return 'Also outside Ri';
    case 'all':
      return null;
  }
}

/** One line on where a skill reaches, with agent names when they're known. */
export function reachSentence(reach: SkillReach, agentName: (id: string) => string | undefined): string {
  switch (reach.mode) {
    case 'off':
      return 'Off. No agent uses it yet.';
    case 'all':
      return 'Every agent in Ri uses it.';
    case 'everywhere':
      return 'Every agent in Ri uses it, and so do Claude Code, Codex and Cursor on this computer.';
    case 'agents': {
      const names = reach.workspaceIds.map((id) => agentName(id) ?? 'an agent that was removed');
      return names.length === 1 ? `Only ${names[0]} uses it.` : `Only these agents use it: ${names.join(', ')}.`;
    }
  }
}

export const REACH_OPTIONS: ReadonlyArray<{ mode: SkillReach['mode']; label: string; detail: string }> = [
  { mode: 'all', label: 'Every agent', detail: 'Every chat and execution in Ri.' },
  {
    mode: 'everywhere',
    label: 'Every agent, and outside Ri',
    detail: 'Also Claude Code, Codex and Cursor in any folder on this computer.',
  },
  { mode: 'agents', label: 'Only some agents', detail: 'Just the agents you pick.' },
  { mode: 'off', label: 'Off', detail: 'No agent uses it. The Try it tab still does.' },
];
