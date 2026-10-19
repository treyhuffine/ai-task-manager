'use client';

import { useSession } from '@/hooks/use-execution';
import { isImportMirror } from '@/lib/import/mirror';

export function useAuthoringDestination(sessionId: string | null, enabled: boolean) {
  const session = useSession(enabled ? sessionId : null);
  const reason = !sessionId ? 'The authoring conversation is unavailable.'
    : session.isLoading ? 'Loading the authoring conversation.'
    : !session.data ? 'The authoring conversation is unavailable.'
    : session.data.status === 'archived' || session.data.execution?.status === 'archived' ? 'Resume the authoring conversation before requesting more work.'
    : session.data.execution?.takeoverStartedAt || isImportMirror(session.data) ? 'The authoring conversation is read-only. Existing output can still be saved.'
    : session.data.surfaceKind === 'result_review' ? 'This is a reviewer conversation. Feedback belongs to the author.'
    : null;
  return { available: !!session.data && !reason, reason };
}
