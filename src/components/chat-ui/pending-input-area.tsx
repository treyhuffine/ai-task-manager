'use client';

import { usePendingInput, useRuntimeStatus } from '@/hooks/use-execution';
import { QuestionCard } from './questions/question-card';
import { PermissionCard } from './permissions/permission-card';

interface PendingInputAreaProps {
  sessionId: string;
}

/**
 * Inline area shown above the composer when the agent is waiting for
 * the user — either a structured question (`AskUserQuestion`) or a
 * tool permission request. Renders nothing when there's nothing pending
 * so the composer sits flush against the transcript.
 *
 * Lives in normal layout flow (not absolute) so the transcript above
 * is never obscured: stick-to-bottom auto-pins the conversation just
 * above this card. If the user scrolls up to look at history, this
 * card stays anchored at the bottom of the viewport with the composer.
 *
 * We render the most recent pending entry. If multiple stack up, the
 * older ones queue behind and surface in turn as the user resolves the
 * top one. Claude rarely emits more than one approval at a time, and
 * a stack of cards would compete with the transcript for attention.
 */
export function PendingInputArea({ sessionId }: PendingInputAreaProps) {
  const { data: pending } = usePendingInput(sessionId);
  const { data: runtime } = useRuntimeStatus(sessionId);
  if (!pending || pending.length === 0) return null;

  const top = pending[pending.length - 1];
  const canAnswer = (top.kind === 'question' ? runtime?.canAnswer : runtime?.canApprove) !== false;

  return (
    <div className="flex-shrink-0">
      <div className="px-5 pt-3 pb-3 max-w-3xl mx-auto">
        {!canAnswer && <p role="status" className="mb-2 text-[11px] text-muted-foreground">A signed-in member with permission can answer this request.</p>}
        <fieldset disabled={!canAnswer} inert={!canAnswer} className="min-w-0 border-0 p-0">
        {top.kind === 'question' ? (
          <QuestionCard key={top.requestId} pending={top} sessionId={sessionId} />
        ) : (
          <PermissionCard key={top.requestId} pending={top} sessionId={sessionId} />
        )}
        </fieldset>
        {pending.length > 1 && (
          <div className="text-[10px] text-muted-foreground/70 mt-1 text-center">
            +{pending.length - 1} more pending
          </div>
        )}
      </div>
    </div>
  );
}
