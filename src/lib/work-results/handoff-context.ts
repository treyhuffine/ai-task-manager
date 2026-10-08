import { getChatSessionWithExecution, getUserState } from '@/lib/db/queries';
import type { UserStateRecord, WorkspaceRecord, WorkResultActor } from '@/db/types';
import { ActionError } from '@/lib/orchestrator/types';
import { isImportMirror } from '@/lib/import/mirror';
import { assertHandoffsEnabled } from './capabilities';
import { builtInHandoffInstructions } from './instructions';
import { getWorkResultSourceWorkspace } from './reviewer-preferences';

export interface WorkResultGuidanceSnapshot {
  sharedGuidance: UserStateRecord['workResultGuidance'];
  agentGuidance: WorkspaceRecord['workResultGuidance'];
  agent: Pick<WorkspaceRecord, 'id' | 'name'> | null;
}

/** Resolve preferences at the workflow boundary, never in ordinary turns. */
export function resolveWorkResultGuidance(userId: string, workspace: WorkspaceRecord | null): WorkResultGuidanceSnapshot {
  // Workspaces belong to this single-owner home. Caller and execution
  // ownership is checked before resolving their recorded association.
  const owned = userId === 'local' ? workspace : null;
  return {
    // The current local home has one shared preference record. It never
    // supplies another owner's guidance to a synthetic foreign context.
    sharedGuidance: userId === 'local' ? getUserState()?.workResultGuidance?.trim() || null : null,
    agentGuidance: owned?.workResultGuidance?.trim() || null,
    agent: owned ? { id: owned.id, name: owned.name } : null,
  };
}

export function renderWorkResultGuidance(guidance: WorkResultGuidanceSnapshot): string {
  return [
    '## Handoff preparation and review preferences',
    'This is the complete preference snapshot for this handoff workflow. It replaces earlier shared and agent handoff guidance, including guidance that is now unset.',
    'These preferences apply only while preparing, reporting or reviewing a handoff. The current request takes precedence over agent handoff guidance, and agent guidance takes precedence over shared handoff guidance. Preferences do not override app authorization, runtime guards, read-only restrictions, the assigned target or reporting transport. They do not authorize an independent review, acceptance, delivery or task completion.',
    guidance.sharedGuidance ? `### Shared handoff guidance\n\n${guidance.sharedGuidance}` : '### Shared handoff guidance\n\nNo shared handoff guidance is currently set.',
    guidance.agentGuidance ? `### Handoff guidance for the "${guidance.agent!.name}" agent\n\n${guidance.agentGuidance}` : '### Agent handoff guidance\n\nNo agent handoff guidance applies to this handoff.',
  ].join('\n\n');
}

/** Signed producers receive their own context, with no caller-selected scope. */
export function getWorkResultHandoffContext(actor: WorkResultActor) {
  assertHandoffsEnabled();
  if (actor.source !== 'ai' || !actor.sessionId) {
    throw new ActionError('unsupported', 'Handoff context requires a signed producing Ri chat.');
  }
  const session = getChatSessionWithExecution(actor.sessionId);
  if (!session || session.userId !== actor.userId || actor.userId !== 'local') {
    throw new ActionError('not_found', 'The producing conversation is unavailable.');
  }
  if (actor.executionId && actor.executionId !== session.executionId) {
    throw new ActionError('invalid_params', 'Caller execution does not match the signed producing conversation.');
  }
  if (session.surfaceKind === 'result_review' || session.status === 'archived'
    || session.execution?.status === 'archived' || isImportMirror(session)) {
    throw new ActionError('unsupported', 'Handoff context is available only to an active producing conversation.');
  }
  const workspace = getWorkResultSourceWorkspace(actor.userId, session.id, session.executionId);
  const guidance = resolveWorkResultGuidance(actor.userId, workspace);
  return { instructions: [builtInHandoffInstructions(), renderWorkResultGuidance(guidance)].join('\n\n'), ...guidance };
}
