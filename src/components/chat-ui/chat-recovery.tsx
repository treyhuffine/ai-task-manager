'use client';

import type { SessionRuntimeStatus } from '@/lib/executor/runtime-status';
import { RestartMenuItem } from '@/components/executions/restart-menu-item';

/**
 * The same recovery and process diagnostic for every chat surface, shown by
 * one rule: the chat is blocked because its previous harness hasn't
 * confirmed it stopped. The next send retries that confirmation by itself,
 * so this says why a message was refused and offers Restart chat to check
 * now. Restart for a healthy chat lives in the chat's menu.
 */
export function ChatRecovery({ sessionId, runtime }: { sessionId: string; runtime?: SessionRuntimeStatus }) {
  return <>
    {runtime?.closeUnconfirmed && <p role="status" className="px-3 py-1 text-xs text-muted-foreground">{runtime.closeProblem ?? 'The previous harness has not confirmed it stopped. Your next message checks again before a new one starts. Saved changes are preserved.'}</p>}
    <div className="ml-auto w-44"><RestartMenuItem sessionId={sessionId} active={runtime?.canStop !== false && Boolean(runtime?.closeUnconfirmed)} /></div>
  </>;
}
