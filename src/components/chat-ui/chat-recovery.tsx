'use client';

import type { SessionRuntimeStatus } from '@/lib/executor/runtime-status';
import { RestartMenuItem } from '@/components/executions/restart-menu-item';

/** The same recovery and process diagnostic for every chat surface. */
export function ChatRecovery({ sessionId, runtime, onRestart, active = false }: { sessionId: string; runtime?: SessionRuntimeStatus; onRestart?: () => void; active?: boolean }) {
  return <>
    {runtime?.closeUnconfirmed && <p role="status" className="px-3 py-1 text-xs text-muted-foreground">{runtime.closeProblem ?? 'The previous harness has not confirmed it stopped. Restart this chat before sending again. Saved changes are preserved.'}</p>}
    <div className="ml-auto w-44"><RestartMenuItem sessionId={sessionId} onRestart={onRestart} active={runtime?.canStop !== false && Boolean(runtime?.closeUnconfirmed || active)} /></div>
  </>;
}
