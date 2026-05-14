'use client';

import { useState } from 'react';
import { Laptop } from 'lucide-react';
import { useClientLocation } from '@/hooks/use-client-location';
import { useTakeover } from '@/hooks/use-takeover';
import type { ChatSessionRecord, WorkspaceRecord } from '@/db/types';
import type { TakeoverResponse } from '@/lib/api/sessions';
import { TakeoverModal } from './takeover-modal';

interface TakeoverButtonProps {
  session: ChatSessionRecord;
  workspace: WorkspaceRecord | undefined | null;
}

/**
 * "Take over locally" entry in the session menu. Hidden when:
 *   - browser is on the host machine (the user is already local —
 *     they can just open the editor),
 *   - workspace is not git (no remote to push to),
 *   - session already in takeover state.
 *
 * Clicking starts the takeover, which pushes the branch and pops a
 * modal with the copy-paste `flow takeover <url>` command.
 */
export function TakeoverButton({ session, workspace }: TakeoverButtonProps) {
  const location = useClientLocation();
  const takeover = useTakeover(session.id);
  const [modalData, setModalData] = useState<TakeoverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (location.kind === 'host') return null;
  if (!workspace?.is_git) return null;
  if (session.takeover_started_at) return null;
  if (session.status === 'archived') return null;

  const handleClick = () => {
    setError(null);
    takeover.start.mutate(undefined, {
      onSuccess: (data) => setModalData(data),
      onError: (err) => setError(err instanceof Error ? err.message : String(err)),
    });
  };

  return (
    <>
      <button
        onClick={handleClick}
        disabled={takeover.start.isPending}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-foreground hover:bg-muted/60 transition-colors disabled:opacity-60"
      >
        <Laptop size={11} />
        {takeover.start.isPending ? 'Preparing takeover…' : 'Take over locally'}
      </button>
      {error && (
        <div className="px-2 py-1 text-[10.5px] text-destructive">{error}</div>
      )}
      {modalData && (
        <TakeoverModal
          sessionId={session.id}
          data={modalData}
          onClose={() => setModalData(null)}
        />
      )}
    </>
  );
}
