'use client';
import { NoteList } from '@/components/notes/note-list';
import { useTeamNav } from './team-context';
export function TeamNotes() {
  const nav = useTeamNav();
  return <NoteList decisionsOnly={nav.decisions} onDecisionsChange={nav.setDecisions} onOpenNote={nav.openNote}
    privatePlanning={false} areaFilter={nav.areaId ?? 'all'} onAreaFilterChange={value => nav.filterArea(value === 'all' ? null : value)} onSearch={() => nav.openPanel('search')} />;
}
