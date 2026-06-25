import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { EntityVersionRecord, EntityVersionSnapshot } from '@/db/types';

export type VersionedEntityType = 'task' | 'note';

/**
 * Change history for a note/task, newest first. Shared by the note/task
 * "review changes" affordance and the diff modal so both read one cache.
 */
export function useEntityVersions(entityType: VersionedEntityType, entityId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['entity-versions', entityType, entityId],
    queryFn: () =>
      api.get<{ versions: EntityVersionRecord[] }>(
        `/entity-versions?entityType=${entityType}&entityId=${entityId}`,
      ),
    enabled: enabled && !!entityId,
    staleTime: 15_000,
  });
}

/** The empty/before-creation state, used as the "old" side of the first change. */
export const EMPTY_SNAPSHOT: EntityVersionSnapshot = { title: null, body: '' };

/**
 * A reviewable change: a *run* of consecutive same-author versions collapsed
 * into one net diff. This is the key to making undo legible — the agent (and
 * the debounced editor) often write a body in several incremental saves; the
 * user thinks of that as one change ("the AI wrote the spec"), not five.
 *
 * `after` is the run's newest snapshot (the "new" file); `before` is the
 * version immediately preceding the run (the "old" file), or null when the
 * run reaches the entity's beginning. Undo restores `before`.
 */
export interface ChangeGroup {
  source: EntityVersionRecord['source'];
  after: EntityVersionRecord;
  before: EntityVersionRecord | null;
  /** How many raw versions were collapsed into this change. */
  count: number;
}

/** Collapse a newest-first version list into newest-first change groups. */
export function groupVersions(versions: EntityVersionRecord[]): ChangeGroup[] {
  const groups: ChangeGroup[] = [];
  let i = 0;
  while (i < versions.length) {
    const source = versions[i].source;
    let j = i;
    while (j + 1 < versions.length && versions[j + 1].source === source) j++;
    groups.push({
      source,
      after: versions[i],
      before: versions[j + 1] ?? null,
      count: j - i + 1,
    });
    i = j + 1;
  }
  return groups;
}
