import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import { invalidateTaskListsSoon } from '@/lib/query/invalidate-tasks';
import { getQueryClient } from '@/lib/query/client';
import { entityKeys } from '@/lib/query/entity-keys';
import { myRiClient } from '@/lib/spaces/my-ri-client';

/**
 * Add to my work and its undo (docs/homes-spec.md §9.3): a team task kept in
 * My Ri, or let go, without changing who it's assigned to at the team.
 */
export async function addToMyWork(teamId: string, taskId: string): Promise<boolean> {
  try {
    await myRiClient.spaces.addToMyWork.mutate({ teamId, taskId });
    toast.success('Added to your work in My Ri.');
    return true;
  } catch (err) {
    toast.error(apiErrorText(err));
    return false;
  }
}

/** Save a team note beside personal notes, or let it go. The team's note is unchanged either way. */
export async function saveToMyNotes(teamId: string, noteId: string): Promise<boolean> {
  try {
    await myRiClient.spaces.saveNote.mutate({ teamId, noteId });
    toast.success('Saved to your notes in My Ri.');
    return true;
  } catch (err) {
    toast.error(apiErrorText(err));
    return false;
  }
}

export async function removeFromMyNotes(teamId: string, noteId: string): Promise<void> {
  try {
    await myRiClient.spaces.removeNote.mutate({ teamId, noteId });
    void getQueryClient().invalidateQueries({ queryKey: entityKeys.notes.all });
    toast.success('Removed from your notes. The team note is unchanged.');
  } catch (err) {
    toast.error(apiErrorText(err));
  }
}

export async function removeFromMyWork(teamId: string, taskId: string): Promise<void> {
  try {
    await myRiClient.spaces.removeFromMyWork.mutate({ teamId, taskId });
    invalidateTaskListsSoon(getQueryClient());
    toast.success('Removed from your work. The team task is unchanged.');
  } catch (err) {
    toast.error(apiErrorText(err));
  }
}
