import type { RemoteRecordKind } from '@/lib/entity-refs/parse-markers';
import type { TeamRecordView } from '@/lib/spaces/team-links';

const WORD: Record<RemoteRecordKind, string> = { task: 'task', note: 'note', area: 'Area' };

export interface TeamRecordLook {
  label: string;
  /** The team to name beside the record. Null when nothing is known of it. */
  team: string | null;
  /** Why it can't be read right now. Null when it can. */
  reason: string | null;
  done: boolean;
  archived: boolean;
  muted: boolean;
  /** Where a click goes: this Ri's shared copy, the team's view, or nowhere. */
  opens: 'copy' | 'team' | null;
}

/**
 * What a link to a team's record shows and does in each state
 * (docs/team-links.md). With no shared copy and no answer, nothing about the
 * record is known, so it's named by its team and kind, never a saved title.
 */
export function describeTeamRecord(kind: RemoteRecordKind, view: TeamRecordView): TeamRecordLook {
  const word = WORD[kind];
  const team = view.teamName;
  const named = view.title?.trim() || (team ? `${team} ${word}` : `${word[0].toUpperCase()}${word.slice(1)} in another Ri`);
  const copy = view.localId && kind !== 'area' ? 'copy' as const : null;
  switch (view.state) {
    case 'found':
      return {
        label: view.title?.trim() || `Untitled ${word}`,
        team,
        reason: null,
        done: view.status === 'done',
        archived: view.status === 'archived',
        muted: view.status === 'archived',
        opens: copy ?? 'team',
      };
    case 'unreachable':
      return { label: named, team, reason: team ? `Can't reach ${team} right now.` : "Can't read this right now.", done: false, archived: false, muted: true, opens: copy ?? 'team' };
    case 'outdated':
      return { label: named, team, reason: `${team} runs a different version of Ri. Update the older one.`, done: false, archived: false, muted: true, opens: copy };
    case 'no_access':
      return { label: named, team, reason: `You no longer have access to ${team}.`, done: false, archived: false, muted: true, opens: copy };
    case 'gone':
      return { label: named, team, reason: `No longer in ${team}.`, done: false, archived: false, muted: true, opens: copy };
    case 'unknown_home':
      return { label: named, team: null, reason: "This Ri isn't connected to the team this is in.", done: false, archived: false, muted: true, opens: null };
  }
}
