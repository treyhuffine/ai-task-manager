'use client';
import { TaskSlideout } from '@/components/tasks/task-slideout';
import { NoteSlideout } from '@/components/notes/note-slideout';
import { useTeamNav } from './team-context';

/** Legacy embedding adapter. Both Homes render the same complete detail sheets. */
export function TeamRecordControls() {
  const nav = useTeamNav();
  return <><TaskSlideout taskId={nav.taskId} onClose={nav.closeDetail} onCloseAll={nav.closeDetail} hasHistory={false} />
    <NoteSlideout noteId={nav.noteId} onClose={nav.closeDetail} onCloseAll={nav.closeDetail} hasHistory={false} /></>;
}
