import type { QueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { toast } from 'sonner';
import { workspacesApi } from '@/lib/api/workspaces';
import { sessionsApi } from '@/lib/api/sessions';
import { apiErrorText } from '@/lib/api/client';
import type { Attachment, EffortLevel } from '@/db/types';
import { markLaunchPending, clearLaunchPending } from './pending-launch';

export interface StartExecutionArgs {
  workspaceId: string;
  label?: string | null;
  baseBranch?: string | null;
  prNumber?: number | null;
  liveMode?: boolean;
  harness?: string | null;
  model?: string | null;
  modelVariant?: string | null;
  effort?: EffortLevel | null;
  /**
   * Sent as the first message once the row exists. Kept inside this call so
   * the caller doesn't have to stay mounted to chain it — the launcher closes
   * immediately, and the rail's ➕ never had a prompt to begin with.
   */
  message?: { content: string; attachments?: Attachment[] } | null;
}

export interface StartedExecution {
  /** Navigate here now. The row lands under the view a moment later. */
  sessionId: string;
  /** Resolves when the row (and its first message, if any) has landed, rejects never — failures are toasted. */
  done: Promise<void>;
}

/**
 * Create an execution without making the user watch.
 *
 * Every caller of this did the same thing before: await the create, read
 * `session.id` off the response, then navigate. That put the whole round-trip
 * in front of the user for no reason other than not knowing the id yet — and
 * this particular round-trip queues behind the app's open SSE streams, so it
 * ran anywhere from a second to long enough that the launcher read as hung.
 *
 * The id is the only thing navigation ever needed, so we mint it here and send
 * it along. The server uses it verbatim, which means the destination is valid
 * the instant this returns and the create can finish underneath a view that's
 * already on screen. See `pending-launch.ts` for how the view is taught to
 * wait out the gap.
 *
 * Deliberately not a hook: the launcher unmounts the moment it navigates, and
 * work that outlives its caller shouldn't be owned by that caller's lifecycle.
 * `qc` is the app-wide singleton, so cache seeding and invalidation still land.
 */
export function startExecution(qc: QueryClient, args: StartExecutionArgs): StartedExecution {
  const sessionId = uuidv7();
  markLaunchPending(sessionId);

  const done = (async () => {
    try {
      const session = await workspacesApi.createSession(args.workspaceId, {
        sessionId,
        label: args.label ?? null,
        baseBranch: args.baseBranch ?? null,
        prNumber: args.prNumber ?? null,
        liveMode: args.liveMode ?? false,
        harness: args.harness ?? null,
        model: args.model ?? null,
        modelVariant: args.modelVariant ?? null,
        effort: args.effort ?? null,
      });

      // Seed before invalidating. The execution view is already mounted and
      // polling for this row; handing it the response directly is the
      // difference between rendering now and rendering on the next retry.
      qc.setQueryData(['session', session.id], session);
      qc.invalidateQueries({ queryKey: ['workspaces', args.workspaceId, 'sessions'] });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      qc.invalidateQueries({ queryKey: ['sessions', 'rail'] });

      const content = args.message?.content?.trim();
      if (content) {
        await sessionsApi.sendMessage(sessionId, content, {
          eventId: uuidv7(),
          attachments: args.message?.attachments,
        });
      }
    } catch (err) {
      // Whoever asked for this has already been sent somewhere else, so there
      // is no form left to put an inline error on. A toast is the only surface
      // that still exists, and it has to be shown: the view the user is
      // looking at right now is the one that will never fill in.
      toast.error("Couldn't start that chat", { description: apiErrorText(err) });
    } finally {
      // Either the row exists or it never will. Either way, stop `useSession`
      // from treating 404s on this id as "still coming".
      clearLaunchPending(sessionId);
    }
  })();

  return { sessionId, done };
}
