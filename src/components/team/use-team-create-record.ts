'use client';

import { useCreateTask } from '@/hooks/use-tasks';
import { useCreateNote } from '@/hooks/use-notes';
import { useTeam, useTeamNav } from './team-context';

/** Board, phone and command palette apply the same visible filter defaults. */
export function useTeamCreateRecord() {
  const { member } = useTeam();
  const nav = useTeamNav();
  const tasks = useCreateTask();
  const notes = useCreateNote();
  const area = nav.areaId ? { areaId: nav.areaId } : {};
  const taskDefaults = { ...area, ...(nav.mine ? { assigneeMemberId: member.id } : {}) };
  const noteDefaults = { ...area, ...(nav.decisions ? { kind: 'decision' as const } : {}) };
  return {
    taskDefaults, noteDefaults,
    async task() {
      const row = await tasks.mutateAsync({ title: ' ', rawInput: ' ', ...taskDefaults });
      nav.openTask(row.id);
      return row;
    },
    async note() {
      const row = await notes.mutateAsync({ body: '', ...noteDefaults });
      nav.openNote(row.id);
      return row;
    },
  };
}
